"""方法 C（基準）：iot_server 目前的做法 —— 這件衣物過去「乾了」的時間取平均，沒有紀錄就用全部平均。
不看即時重量，整場都預測同一個時間。

    uv run python scripts/predict_history_mean.py
"""
import numpy as np

from clothes_predict.evaluate import Prediction, all_sessions, replay

DATA = all_sessions()


class HistoryMean:
    def __init__(self, prior):
        me = prior["_session"]
        same = [tr["t_dry"] for s, m, tr in DATA if s["garment"] == me["garment"] and s["id"] != me["id"]]
        pool = same or [tr["t_dry"] for s, m, tr in DATA if s["id"] != me["id"]]
        self.t_dry = float(np.mean(pool))
        self.t = 0.0

    def update(self, t, w, aux=None):
        self.t = t

    def predict(self):
        return Prediction(min(self.t / self.t_dry, 1.0), max(self.t_dry, self.t), np.nan)


if __name__ == "__main__":
    replay(HistoryMean, DATA, name="history_mean")
