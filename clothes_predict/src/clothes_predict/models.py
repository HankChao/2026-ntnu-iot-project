"""乾燥曲線模型（純函式，Kalman 和曲線擬合共用，之後照抄成 TypeScript）。

兩段式乾燥（等速期 → 減速期），用一條平滑的微分方程表示：
    dm/dt = -R * (1 - exp(-m / Mc))
    m  ：剩下的水，R：等速期的蒸發速率（counts/h），Mc：臨界含水量
    m >> Mc 時 dm/dt ≈ -R（直線下降），m << Mc 時 dm/dt ≈ -(R/Mc) m（指數收斂）
有解析解：
    m(t) = Mc * ln(1 + (exp(m0/Mc) - 1) * exp(-R t / Mc))
到達 m* 的時間：
    t = (Mc / R) * ln((exp(m0/Mc) - 1) / (exp(m*/Mc) - 1))

指數模型（對照組）：m(t) = m0 * exp(-k t)
"""
import numpy as np


def twophase_m(m0, R, Mc, t):
    m0 = np.maximum(m0, 1e-9)
    return Mc * np.log1p(np.expm1(m0 / Mc) * np.exp(-R * np.asarray(t) / Mc))


def twophase_time_to(m0, R, Mc, m_target):
    if m0 <= m_target:
        return 0.0
    if R <= 0:
        return np.inf
    return float(Mc / R * np.log(np.expm1(m0 / Mc) / np.expm1(m_target / Mc)))


def exp_m(m0, k, t):
    return m0 * np.exp(-k * np.asarray(t))


def exp_time_to(m0, k, m_target):
    if m0 <= m_target:
        return 0.0
    if k <= 0:
        return np.inf
    return float(np.log(m0 / m_target) / k)
