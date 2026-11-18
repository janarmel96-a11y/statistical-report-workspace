"""Creates independent reference answers with NumPy, SciPy and pandas. The app's code is not used here.
Run:  python tests/golden/make_golden.py   (needs numpy, scipy, pandas)"""
import json
import pathlib

import numpy as np
import pandas as pd
from scipy import stats

rng = np.random.default_rng(20261118)
n = 2400
dates = pd.Timestamp('2022-01-01') + pd.to_timedelta(rng.integers(0, 1095, n), unit='D')
df = pd.DataFrame({
    'Date': dates,
    'Region': rng.choice(['North', 'South', 'East', 'West'], n, p=[.4, .3, .2, .1]),
    'Segment': rng.choice(['Consumer', 'Business', 'Public'], n, p=[.5, .35, .15]),
    'Units': rng.integers(1, 20, n).astype(float),
    'Price': np.round(rng.gamma(4, 12, n) + 2, 2),
})
df['Sales'] = np.round(df.Units * df.Price, 2)
df['Cost'] = np.round(df.Sales * rng.uniform(.45, .85, n), 2)
df.loc[rng.choice(n, 60, replace=False), 'Cost'] = np.nan
df = df.sort_values('Date', kind='stable').reset_index(drop=True)

s = df.Sales.to_numpy()
c = df.dropna(subset=['Cost'])
g = [df.Sales[df.Region == r].to_numpy() for r in ['North', 'South', 'East', 'West']]
ct = pd.crosstab(df.Region, df.Segment).to_numpy()
chi = stats.chi2_contingency(ct, correction=False)
w = stats.ttest_ind(g[0], g[1], equal_var=False)
mw = stats.mannwhitneyu(g[0], g[1], alternative='two-sided', method='asymptotic', use_continuity=True)
an = stats.f_oneway(*g)
kw = stats.kruskal(*g)
p = stats.pearsonr(c.Sales, c.Cost)
sp = stats.spearmanr(c.Sales, c.Cost)
monthly = df.set_index('Date').Sales.resample('MS').sum()


def mann_kendall(x):
    x = np.asarray(x)
    k = len(x)
    total = sum(np.sign(x[j] - x[i]) for i in range(k - 1) for j in range(i + 1, k))
    _, t = np.unique(x, return_counts=True)
    v = (k * (k - 1) * (2 * k + 5) - np.sum(t * (t - 1) * (2 * t + 5))) / 18
    z = (total - np.sign(total)) / np.sqrt(v)
    return {'s': float(total), 'z': float(z), 'p': float(2 * stats.norm.sf(abs(z)))}


ps = [0.001, 0.008, 0.039, 0.041, 0.042, 0.06, 0.074, 0.205, 0.212, 0.216]
ci = stats.t.interval(.95, n - 1, loc=s.mean(), scale=stats.sem(s))
q1, q3 = np.percentile(s, [25, 75])
iqr = q3 - q1
med = np.median(s)
mad = np.median(np.abs(s - med))

m_key = df.Date.dt.strftime('%Y-%m')
by_month = df.groupby(m_key).Sales.sum()


def last_year(k):
    return f"{int(k[:4]) - 1}{k[4:]}"


yoy = {k: (v - by_month[last_year(k)]) / abs(by_month[last_year(k)]) for k, v in by_month.items() if last_year(k) in by_month.index}
d23 = df[df.Date.dt.year == 2023]
ytd = d23.groupby(d23.Date.dt.strftime('%Y-%m')).Sales.sum().cumsum()
f = df[(df.Region == 'North') & (df.Date.dt.year == 2023)]

gold = {
    'rows': {
        'Date': df.Date.dt.strftime('%Y-%m-%d').tolist(), 'Region': df.Region.tolist(), 'Segment': df.Segment.tolist(),
        'Units': df.Units.tolist(), 'Price': df.Price.tolist(), 'Sales': df.Sales.tolist(),
        'Cost': [None if pd.isna(v) else v for v in df.Cost],
    },
    'stats': {
        'sum': float(s.sum()), 'mean': float(s.mean()), 'var': float(s.var(ddof=1)), 'std': float(s.std(ddof=1)), 'median': float(med),
        'p10': float(np.percentile(s, 10)), 'p90': float(np.percentile(s, 90)), 'q1': float(q1), 'q3': float(q3),
        'skew': float(stats.skew(s, bias=False)), 'kurt': float(stats.kurtosis(s, bias=False)),
        'ci': [float(ci[0]), float(ci[1])], 'iqrOutliers': int(((s < q1 - 1.5 * iqr) | (s > q3 + 1.5 * iqr)).sum()),
        'madOutliers': int((np.abs(.6745 * (s - med) / mad) > 3.5).sum()),
        'pearson': [float(p.statistic), float(p.pvalue)], 'spearman': [float(sp.statistic), float(sp.pvalue)],
        'welch': [float(w.statistic), float(w.pvalue), float(w.df)], 'mannwhitney': [float(mw.statistic), float(mw.pvalue)],
        'anova': [float(an.statistic), float(an.pvalue)], 'kruskal': [float(kw.statistic), float(kw.pvalue)],
        'chi2': [float(chi.statistic), float(chi.pvalue), int(chi.dof)], 'crosstab': ct.tolist(),
        'mannKendall': mann_kendall(monthly.to_numpy()), 'monthly': monthly.tolist(),
        'bhInput': ps, 'bh': stats.false_discovery_control(ps, method='bh').tolist(),
    },
    'query': {
        'byRegion': df.groupby('Region').Sales.sum().to_dict(), 'avgByRegion': df.groupby('Region').Sales.mean().to_dict(),
        'medianByRegion': df.groupby('Region').Sales.median().to_dict(), 'countCost': df.groupby('Region').Cost.count().astype(int).to_dict(),
        'shareByRegion': (df.groupby('Region').Sales.sum() / df.Sales.sum()).to_dict(),
        'byMonth': by_month.to_dict(),
        'byQuarter': {f'Q{k.quarter} {k.year}': float(v) for k, v in df.set_index('Date').Sales.resample('QS').sum().items()},
        'running': by_month.cumsum().to_dict(), 'ma3': by_month.rolling(3, min_periods=1).mean().to_dict(),
        'previousMonth': by_month.shift(1).dropna().to_dict(), 'yoy': yoy, 'ytd2023': ytd.to_dict(),
        'filtered': {'rows': int(len(f)), 'sales': float(f.Sales.sum()), 'avgPrice': float(f.Price.mean())},
        'margin': float((df.Sales.where(df.Cost.notna(), df.Sales).sum() - df.Cost.sum()) / df.Sales.sum()),
        'rowMath': float((df.Units * df.Price).sum()),
        'sumIfNorth': float(df.Sales[df.Region == 'North'].sum()), 'countIfLarge': int((df.Sales > 500).sum()),
        'avgIfBusiness': float(df.Sales[df.Segment == 'Business'].mean()), 'distinctRegion': int(df.Region.nunique()),
        'p90': float(np.percentile(s, 90)),
    },
}
# Multiple regression, solved directly with NumPy
X = np.column_stack([np.ones(n), df.Units, df.Price])
y = df.Sales.to_numpy()
inv = np.linalg.inv(X.T @ X)
beta = inv @ X.T @ y
residual = y - X @ beta
dof = n - X.shape[1]
s2 = residual @ residual / dof
se = np.sqrt(np.diag(inv) * s2)
tv = beta / se
sst = ((y - y.mean()) ** 2).sum()
r2 = 1 - (residual @ residual) / sst
gold['regression'] = {
    'coef': beta.tolist(), 'se': se.tolist(), 't': tv.tolist(), 'p': (2 * stats.t.sf(np.abs(tv), dof)).tolist(), 'n': n,
    'r2': float(r2), 'adjR2': float(1 - (1 - r2) * (n - 1) / dof), 'f': float((sst - residual @ residual) / 2 / s2),
}

# Two-proportion z-test
a = df[df.Region == 'North']
b = df[df.Region == 'South']
sa, na, sb, nb = int((a.Segment == 'Business').sum()), len(a), int((b.Segment == 'Business').sum()), len(b)
pa, pb, pool = sa / na, sb / nb, (sa + sb) / (na + nb)
z = (pb - pa) / np.sqrt(pool * (1 - pool) * (1 / na + 1 / nb))
sed = np.sqrt(pa * (1 - pa) / na + pb * (1 - pb) / nb)
crit = stats.norm.ppf(0.975)
gold['ab'] = {'successA': sa, 'totalA': na, 'successB': sb, 'totalB': nb, 'z': float(z), 'p': float(2 * stats.norm.sf(abs(z))), 'low': float(pb - pa - crit * sed), 'high': float(pb - pa + crit * sed)}

out = pathlib.Path(__file__).with_name('golden.json')
out.write_text(json.dumps(gold), encoding='utf8')
print('wrote', out, out.stat().st_size)
