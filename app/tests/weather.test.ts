import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import {
  parseForecastLocation, rainForCounty, rainForStation, selectDistrictObservation, summarizeCounty, weatherRoute, type Observation,
} from '../src/routes/weather';
import { matchesStation, parseObservationStations, parseRainfallStations } from '../src/weather/cwa';
import { observationRow, rainRow } from '../src/weather/poller';
import { attachOutdoor } from '../src/weather/store';
import { codisValue, parseCodisCsv } from '../src/weather/codis';

describe('CWA weather normalization', () => {
  it('joins forecast elements into chronological periods', () => {
    const location = {
      weatherElement: [
        { elementName: 'Wx', time: [{ startTime: '2026-11-22 12:00:00', endTime: '2026-11-22 18:00:00', parameter: { parameterName: '短暫雨', parameterValue: '8' } }] },
        { elementName: 'PoP', time: [{ startTime: '2026-11-22 12:00:00', endTime: '2026-11-22 18:00:00', parameter: { parameterName: '70' } }] },
        { elementName: 'MinT', time: [{ startTime: '2026-11-22 12:00:00', endTime: '2026-11-22 18:00:00', parameter: { parameterName: '19' } }] },
        { elementName: 'MaxT', time: [{ startTime: '2026-11-22 12:00:00', endTime: '2026-11-22 18:00:00', parameter: { parameterName: '23' } }] },
        { elementName: 'CI', time: [{ startTime: '2026-11-22 12:00:00', endTime: '2026-11-22 18:00:00', parameter: { parameterName: '稍有寒意' } }] },
      ],
    };
    expect(parseForecastLocation(location)).toEqual([{
      start: '2026-11-22 12:00:00', end: '2026-11-22 18:00:00', weather: '短暫雨', weather_code: 8,
      rain_probability: 70, min_temp: 19, max_temp: 23, comfort: '稍有寒意',
    }]);
  });

  it('summarizes county observations and keeps the strongest rain and gust', () => {
    const base: Observation = {
      id: 'A', name: '甲站', county: '臺北市', town: '', observed_at: '2026-11-22T12:00:00+08:00', weather: '晴',
      temp: 20, hum: 60, rain_mm: 0, wind_speed: 2, wind_direction: 90, gust_speed: 5, pressure: 1012,
    };
    const result = summarizeCounty([
      base,
      { ...base, id: 'B', name: '乙站', temp: 24, hum: 70, rain_mm: 3.2, wind_speed: 4, gust_speed: 12, observed_at: '2026-11-22T12:10:00+08:00' },
    ], '臺北市');
    expect(result).toMatchObject({ temp: 22, hum: 65, rain_mm: 3.2, wind_speed: 3, wind_direction: 90, gust_speed: 12, stations: 2 });
  });

  it('selects the latest exact station within the requested district', () => {
    const base: Observation = {
      id: 'A', name: '信義舊站', county: '臺北市', town: '信義區', observed_at: '2026-11-22T12:00:00+08:00', weather: '晴',
      temp: 20, hum: 60, rain_mm: 0, wind_speed: 2, wind_direction: 91.4, gust_speed: 5, pressure: 1012,
    };
    const result = selectDistrictObservation([
      base,
      { ...base, id: 'B', name: '信義新站', temp: 24.26, observed_at: '2026-11-22T12:10:00+08:00' },
      { ...base, id: 'C', name: '士林站', town: '士林區', temp: 18, observed_at: '2026-11-22T12:20:00+08:00' },
    ], '臺北市', '信義區');

    expect(result).toMatchObject({ county: '臺北市', district: '信義區', station_id: 'B', station_name: '信義新站', temp: 24.3, wind_direction: 91, stations: 1 });
  });

  it('does not cross county boundaries when district names match', () => {
    const observation = (id: string, county: string): Observation => ({
      id, name: `${county}中正站`, county, town: '中正區', observed_at: '2026-11-22T12:00:00+08:00', weather: '晴',
      temp: county === '臺北市' ? 21 : 27, hum: 60, rain_mm: 0, wind_speed: 2, wind_direction: 90, gust_speed: 5, pressure: 1012,
    });

    expect(selectDistrictObservation([observation('A', '臺北市'), observation('B', '基隆市')], '臺北市', '中正區'))
      .toMatchObject({ county: '臺北市', district: '中正區', station_id: 'A', temp: 21 });
  });
});

// Shaped like the CWA responses (records.Station[]); the field paths are the ones the parser reads.
const stationA0003 = {
  StationName: '臺北', StationId: '466920', ObsTime: { DateTime: '2026-11-25T14:00:00+08:00' },
  GeoInfo: { CountyName: '臺北市', TownName: '中正區' },
  WeatherElement: {
    Weather: '多雲', VisibilityDescription: '>30', SunshineDuration: 3.4, Now: { Precipitation: 1.5 },
    WindDirection: 60, WindSpeed: 2.8, AirTemperature: 22.1, RelativeHumidity: 74, AirPressure: 1015.2, UVIndex: 2.1,
    GustInfo: { PeakGustSpeed: 6.5, Occurred_at: { WindDirection: 70, DateTime: '2026-11-25T13:41:00+08:00' } },
  },
};
const gaugeA0002 = {
  StationName: '臺北', StationId: '466920', ObsTime: { DateTime: '2026-11-25T14:00:00+08:00' },
  GeoInfo: { CountyName: '臺北市', TownName: '中正區' },
  RainfallElement: { Now: { Precipitation: 1.5 }, Past10Min: { Precipitation: 0 }, Past1hr: { Precipitation: 0.5 }, Past24hr: { Precipitation: 1.5 } },
};

describe('CWA observation parsing', () => {
  it('reads sunshine, UV and gust from O-A0003 and keeps the station JSON', () => {
    const [station] = parseObservationStations({ records: { Station: [stationA0003] } }, 'O-A0003-001');
    expect(station).toMatchObject({
      id: '466920', name: '臺北', county: '臺北市', town: '中正區', observed_at: '2026-11-25T14:00:00+08:00', weather: '多雲',
      temp: 22.1, hum: 74, rain_mm: 1.5, wind_speed: 2.8, wind_direction: 60, gust_speed: 6.5, pressure: 1015.2,
      sunshine_h: 3.4, uv: 2.1, dataset: 'O-A0003-001',
    });
    expect(station!.raw).toBe(stationA0003);
  });

  it('turns CWA missing-value codes into null instead of numbers', () => {
    const faulty = { ...stationA0003, WeatherElement: { ...stationA0003.WeatherElement, AirTemperature: -99, SunshineDuration: -990, UVIndex: 'X', Weather: '-99' } };
    const [station] = parseObservationStations({ records: { Station: [faulty] } }, 'O-A0003-001');
    expect(station).toMatchObject({ temp: null, sunshine_h: null, uv: null, weather: null });
  });

  it('reads 10-minute and 1-hour rain from the O-A0002 gauges', () => {
    const [gauge] = parseRainfallStations({ records: { Station: [gaugeA0002] } });
    expect(gauge).toMatchObject({ id: '466920', dataset: 'O-A0002-001', rain_day_mm: 1.5, rain_10min_mm: 0, rain_1h_mm: 0.5 });
  });

  it('adds the gauge of the shown station, or the wettest gauge of the county', () => {
    const [gauge] = parseRainfallStations({ records: { Station: [gaugeA0002] } });
    const other = { ...gauge!, id: 'C0A9C0', rain_10min_mm: 0.5, rain_1h_mm: 4 };
    expect(rainForStation([gauge!, other], '466920')).toEqual({ rain_10min_mm: 0, rain_1h_mm: 0.5 });
    expect(rainForStation([gauge!], 'nowhere')).toEqual({ rain_10min_mm: null, rain_1h_mm: null });
    expect(rainForCounty([gauge!, other], '臺北市')).toEqual({ rain_10min_mm: 0.5, rain_1h_mm: 4 });
  });

  it('matches the station setting by id or by name', () => {
    expect(matchesStation({ id: '466920', name: '臺北' }, '臺北')).toBe(true);
    expect(matchesStation({ id: '466920', name: '臺北' }, '466920')).toBe(true);
    expect(matchesStation({ id: '466920', name: '臺北' }, '板橋')).toBe(false);
  });

  it('maps parsed stations to weather_obs rows', () => {
    const [station] = parseObservationStations({ records: { Station: [stationA0003] } }, 'O-A0003-001');
    expect(observationRow(station!)).toMatchObject({
      dataset: 'O-A0003-001', station_id: '466920', station_name: '臺北', observed_at: '2026-11-25T14:00:00+08:00',
      temp: 22.1, hum: 74, wind_speed: 2.8, wind_dir: 60, gust: 6.5, pressure: 1015.2, rain_day_mm: 1.5, sunshine_h: 3.4, uv: 2.1,
    });
    const [gauge] = parseRainfallStations({ records: { Station: [gaugeA0002] } });
    expect(rainRow(gauge!)).toMatchObject({ dataset: 'O-A0002-001', rain_day_mm: 1.5, rain_10min_mm: 0, rain_1h_mm: 0.5 });
  });
});

describe('Outdoor columns for the clip CSV', () => {
  const t = (minutes: number) => new Date(Date.UTC(2026, 10, 25, 0, 0) + minutes * 60000).toISOString();
  const reading = (minutes: number) => ({ timestamp: t(minutes) }) as { timestamp: string; outdoor?: Record<string, number | null> };

  it('takes each value from the latest observation that has it, within its dataset interval', () => {
    const rows = attachOutdoor([reading(-5), reading(0), reading(5), reading(15), reading(25), reading(65)], [
      { dataset: 'O-A0003-001', observed_at: t(0), temp: 22.456, hum: 70 },
      { dataset: 'O-A0002-001', observed_at: t(0), rain_10min_mm: 0, rain_1h_mm: 0.5 },
      { dataset: 'O-A0003-001', observed_at: t(10), temp: 22.6, hum: null },
    ]);
    expect(rows.map((row) => [row.outdoor!.temp, row.outdoor!.hum, row.outdoor!.rain_1h_mm])).toEqual([
      [null, null, null], // before any observation
      [22.46, 70, 0.5],
      [22.46, 70, 0.5],
      [22.6, 70, 0.5],   // hum missing at 10 min, the 0-min value is still within 20 min
      [22.6, null, null], // 0-min values are now older than 20 min
      [null, null, null], // and the 10-min temperature too
    ]);
  });

  it('keeps hourly CODiS rows valid for the whole following hour', () => {
    const rows = attachOutdoor([reading(30), reading(69), reading(71)], [
      { dataset: 'CODiS', observed_at: t(0), temp: 20, sunshine_1h_h: 0.6, radiation_1h_mj: 1.2 },
    ]);
    expect(rows.map((row) => [row.outdoor!.temp, row.outdoor!.sunshine_1h_h])).toEqual([[20, 0.6], [20, 0.6], [null, null]]);
  });
});

describe('Stored weather API', () => {
  it('reports 503 instead of an empty list when the database is not available', async () => {
    const app = new Hono().route('/weather', weatherRoute);
    const response = await app.request('/weather/stored');
    expect(response.status).toBe(503);
    expect(((await response.json()) as { poller?: unknown }).poller).toBeDefined();
  });

  it('rejects ranges over 7 days', async () => {
    const app = new Hono().route('/weather', weatherRoute);
    expect((await app.request('/weather/stored?start=2026-11-01T00:00:00Z&end=2026-11-20T00:00:00Z')).status).toBe(400);
  });
});

describe('CODiS hourly CSV import', () => {
  const station = { id: '466920', name: '臺北' };
  const chinese = [
    '測站,臺北',
    '觀測時間(hour),測站氣壓(hPa),氣溫(℃),相對溼度(%),風速(m/s),風向(360degree),最大瞬間風(m/s),最大瞬間風風向(360degree),降水量(mm),日照時數(hour),全天空日射量(MJ/㎡),紫外線指數',
    'ObsTime,StnPres,Temperature,RH,WS,WD,WSGust,WDGust,Precp,SunShine,GloblRad,UVI',
    '13,1013.0,25.5,55,3.1,100,7.8,110,T,0.8,1.85,4',
    '24,1014.8,20.2,82,X,V,5.0,/,0.5,,0.00,0',
  ].join('\r\n');

  it('maps Chinese titles, stores hour H as the end of the hour and rolls 24 over to the next day', () => {
    const { rows, skipped } = parseCodisCsv(chinese, station, '2026-11-14');
    expect(skipped).toBe(0);
    expect(rows.map((row) => new Date(row.observed_at).toISOString())).toEqual(['2026-11-14T05:00:00.000Z', '2026-11-14T16:00:00.000Z']);
    expect(rows[0]).toMatchObject({ dataset: 'CODiS', station_id: '466920', station_name: '臺北', pressure: 1013, temp: 25.5, hum: 55,
      wind_speed: 3.1, wind_dir: 100, gust: 7.8, rain_1h_mm: 0, sunshine_1h_h: 0.8, radiation_1h_mj: 1.85, uv: 4 });
    // 最大瞬間風風向 is not mistaken for 風向; X (fault) and V (variable wind) are missing, not zero.
    expect(rows[1]).toMatchObject({ wind_speed: null, wind_dir: null, gust: 5, rain_1h_mm: 0.5, sunshine_1h_h: null });
  });

  it('reads files with English codes and full date-times, and needs --date for hour-only files', () => {
    const english = 'ObsTime,Temperature,RH,Precp\n2026-11-14 01:00,21.4,76,0.0\n"2026/11/14 02:00",21.0,79,T\n';
    expect(parseCodisCsv(english, station).rows.map((row) => [new Date(row.observed_at).toISOString(), row.temp, row.rain_1h_mm]))
      .toEqual([['2026-11-13T17:00:00.000Z', 21.4, 0], ['2026-11-13T18:00:00.000Z', 21, 0]]);
    expect(parseCodisCsv(chinese, station).rows).toHaveLength(0);
  });

  it('refuses files that are not hourly observations', () => {
    expect(() => parseCodisCsv('a,b\n1,2\n', station)).toThrow('標題列');
    expect(() => parseCodisCsv('觀測時間,降水量\n2026-11-14 01:00,0\n', station)).toThrow('氣溫');
  });

  it('treats trace and missing-value codes by field', () => {
    expect(codisValue('T', 'rain_1h_mm')).toBe(0);
    expect(codisValue('T', 'temp')).toBeNull();
    expect(codisValue('-9.8', 'rain_1h_mm')).toBeNull();
    expect(codisValue('-3.5', 'temp')).toBe(-3.5);
    expect(codisValue('-99.5', 'temp')).toBeNull();
    expect(codisValue('&', 'rain_1h_mm')).toBeNull();
  });
});
