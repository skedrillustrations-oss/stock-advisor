"""
Evening analysis engine for the Stock Advisor trial website.

What it does, in order:
  1. Downloads up to 5 years of daily prices for every stock in stocks.csv
     (free, from Yahoo Finance via the yfinance library).
  2. Scores every stock from 0 to 100 using simple, proven rules
     (trend, momentum, how calm the price is, and where it sits versus its high).
  3. Sets a take-profit target and a safety exit for each stock.
  4. Replays the same rules over the past 5 years (a "backtest") to show how
     often setups like today's worked before.
  5. Keeps a live log of every pick from today onwards and checks each
     evening whether it hit its target or its safety exit.
  6. Writes JSON files that the website reads (docs/data/).
  7. Emails subscribers about new High chance picks and time-to-sell moments.

Run:  python engine/analyze.py            (real data)
      python engine/analyze.py --sample   (made-up data, for testing only)

This is an educational tool. It is not financial advice.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import math
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "data"
STOCK_DIR = DATA / "stocks"

CURRENCY = {"EGX": "EGP", "DFM": "AED", "ADX": "AED"}
MARKET_NAME = {"EGX": "Egypt", "DFM": "Dubai", "ADX": "Abu Dhabi"}
# Yahoo Finance ticker endings. Abu Dhabi is tried with two endings.
SUFFIXES = {"EGX": [".CA"], "DFM": [".AE"], "ADX": [".AD", ".AE"]}

HORIZON = 40            # trading days we give a pick to work (about 8 weeks)
TIERS = [("High", 75), ("Good", 60), ("Weak", 45)]
MIN_ROWS = 260          # need at least about a year of prices


# ---------------------------------------------------------------- data ----

def load_universe() -> list[dict]:
    with open(ROOT / "engine" / "stocks.csv", newline="", encoding="utf-8") as f:
        return [r for r in csv.DictReader(f) if r.get("symbol")]


def fetch_yahoo(row: dict) -> tuple[pd.DataFrame | None, str | None]:
    import yfinance as yf

    for sfx in SUFFIXES[row["market"]]:
        ticker = row["symbol"] + sfx
        try:
            df = yf.Ticker(ticker).history(period="5y", interval="1d", auto_adjust=True)
        except Exception as e:  # network or Yahoo hiccup
            print(f"  ! {ticker}: {e}")
            continue
        if df is not None and len(df) >= MIN_ROWS:
            df = df.rename(columns=str.title)
            df.index = pd.to_datetime(df.index).tz_localize(None).normalize()
            df = df[["Open", "High", "Low", "Close", "Volume"] + (["Dividends"] if "Dividends" in df else [])]
            df = df[df["Close"] > 0].dropna(subset=["Close"])
            return df, ticker
    return None, None


def fake_prices(row: dict, seed: int) -> pd.DataFrame:
    """Random-walk prices used only by --sample, to test the website."""
    rng = np.random.default_rng(seed)
    days = pd.bdate_range(end=pd.Timestamp.today().normalize(), periods=1250)
    drift = rng.uniform(-0.0002, 0.0009)
    vol = rng.uniform(0.010, 0.028)
    r = rng.normal(drift, vol, len(days))
    close = 20 * rng.uniform(0.5, 5) * np.exp(np.cumsum(r))
    high = close * (1 + np.abs(rng.normal(0, vol / 2, len(days))))
    low = close * (1 - np.abs(rng.normal(0, vol / 2, len(days))))
    div = np.zeros(len(days))
    if rng.random() < 0.6:
        div[::250] = close[::250] * 0.03
    return pd.DataFrame({"Open": close, "High": high, "Low": low, "Close": close,
                         "Volume": rng.integers(1e5, 1e7, len(days)), "Dividends": div}, index=days)


# ---------------------------------------------------------- indicators ----

def indicators(df: pd.DataFrame) -> pd.DataFrame:
    c = df["Close"]
    out = pd.DataFrame(index=df.index)
    out["close"] = c
    out["sma50"] = c.rolling(50).mean()
    out["sma200"] = c.rolling(200).mean()
    out["slope200"] = out["sma200"] / out["sma200"].shift(20) - 1
    delta = c.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / 14, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / 14, adjust=False).mean()
    out["rsi"] = 100 - 100 / (1 + gain / loss.replace(0, np.nan))
    prev = c.shift(1)
    tr = pd.concat([df["High"] - df["Low"], (df["High"] - prev).abs(), (df["Low"] - prev).abs()], axis=1).max(axis=1)
    out["atr_pct"] = tr.rolling(14).mean() / c
    out["vol"] = c.pct_change().rolling(60).std() * math.sqrt(250)
    out["ret63"] = c / c.shift(63) - 1
    out["high252"] = c.rolling(252, min_periods=120).max()
    out["dd"] = c / out["high252"] - 1
    return out


def rule_score(ind: pd.DataFrame) -> pd.DataFrame:
    up = ind["close"] > ind["sma200"]
    trend = up * 15 + (ind["sma50"] > ind["sma200"]) * 10 + (ind["slope200"] > 0) * 10

    r = ind["ret63"]
    mom = np.where(r < 0, 0, np.where(r <= 0.25, 8 + 7 * (1 - (r - 0.10).abs() / 0.15).clip(0, 1), 4))
    rsi = ind["rsi"]
    rsi_pts = np.select([(rsi >= 40) & (rsi <= 65), (rsi >= 30) & (rsi < 40) & up, rsi > 72], [10, 10, 0], 5)
    momentum = mom + rsi_pts

    calm = (25 * (0.60 - ind["vol"]) / 0.40).clip(0, 25)

    d = ind["dd"]
    position = np.select(
        [(d <= -0.03) & (d >= -0.15), d > -0.03, (d < -0.15) & (d >= -0.30) & up, (d < -0.15) & (d >= -0.30)],
        [15, 8, 6, 2], 0)

    s = pd.DataFrame(index=ind.index)
    s["trend"], s["momentum"], s["calm"], s["position"] = trend, momentum, calm, position
    s["score"] = (s["trend"] + s["momentum"] + s["calm"] + s["position"]).round()
    s.loc[ind["sma200"].isna() | ind["vol"].isna(), "score"] = np.nan
    s["stop_pct"] = (2.0 * ind["atr_pct"]).clip(0.04, 0.12)
    s["target_pct"] = (2.0 * s["stop_pct"]).clip(0.06, 0.25)
    return s


def tier_of(score: float) -> str | None:
    if score is None or (isinstance(score, float) and math.isnan(score)):
        return None
    for name, cut in TIERS:
        if score >= cut:
            return name
    return None


def risk_of(vol: float) -> int:
    """0 = very calm, 100 = very jumpy. Based on how much the price swings."""
    if vol is None or math.isnan(vol):
        return 50
    return int(round(min(100, max(0, (vol - 0.10) / 0.50 * 100))))


# ------------------------------------------------------------ outcomes ----

def evaluate(df: pd.DataFrame, start_idx: int, entry: float, tp: float, sl: float):
    """Walk forward from the day after start_idx. Returns (status, exit_idx, exit_price)."""
    hi, lo, cl = df["High"].values, df["Low"].values, df["Close"].values
    target, stop = entry * (1 + tp), entry * (1 - sl)
    last = min(len(df) - 1, start_idx + HORIZON)
    for j in range(start_idx + 1, last + 1):
        if lo[j] <= stop:            # check the loss first, to be cautious
            return "loss", j, stop
        if hi[j] >= target:
            return "win", j, target
    if start_idx + HORIZON <= len(df) - 1:
        p = cl[start_idx + HORIZON]
        return ("win" if p > entry else "loss"), start_idx + HORIZON, p
    return "open", None, None


def backtest(df: pd.DataFrame, sc: pd.DataFrame, meta: dict) -> list[dict]:
    out, i, n = [], 252, len(df)
    scores = sc["score"].values
    while i < n - 1:
        s = scores[i]
        t = tier_of(s)
        if t is None:
            i += 1
            continue
        entry = df["Close"].iat[i]
        status, j, px = evaluate(df, i, entry, sc["target_pct"].iat[i], sc["stop_pct"].iat[i])
        if status == "open":
            break
        out.append({"symbol": meta["symbol"], "market": meta["market"], "tier": t, "score": int(s),
                    "date": df.index[i].strftime("%Y-%m-%d"), "exit_date": df.index[j].strftime("%Y-%m-%d"),
                    "result": status, "ret": round(px / entry - 1, 4), "days": int(j - i)})
        i = j + 1   # one pick per stock at a time
    return out


# ------------------------------------------------------- explanations ----

def checks_and_words(ind_row, sc_row, meta) -> tuple[list, str, str]:
    checks = []
    up = ind_row["close"] > ind_row["sma200"]
    checks.append({"ok": "yes" if up else "no",
                   "text": "Price above its 200-day average (long rising trend)" if up
                   else "Price below its 200-day average (long trend is down)"})
    checks.append({"ok": "yes" if ind_row["sma50"] > ind_row["sma200"] else "no",
                   "text": "Recent trend stronger than the long trend"})
    r = ind_row["ret63"]
    checks.append({"ok": "yes" if 0 <= r <= 0.25 else ("warn" if r > 0.25 else "no"),
                   "text": f"Last 3 months: {r*100:+.1f}%" + (" (rose fast, may cool down)" if r > 0.25 else "")})
    rsi = ind_row["rsi"]
    checks.append({"ok": "warn" if rsi > 70 else ("yes" if 30 <= rsi <= 65 else "no"),
                   "text": "Not overheated right now" if rsi <= 70 else "Overheated right now (bought heavily lately)"})
    v = ind_row["vol"]
    level = "low" if v < 0.25 else "medium" if v < 0.40 else "high"
    checks.append({"ok": "yes" if level == "low" else "warn" if level == "medium" else "no",
                   "text": f"How jumpy the price is: {level}"})
    d = ind_row["dd"]
    checks.append({"ok": "yes" if -0.15 <= d <= -0.03 else "warn",
                   "text": f"{abs(d)*100:.0f}% below its 1-year high"})

    why = []
    if up and ind_row["slope200"] > 0:
        why.append("The price has been rising steadily over the past months.")
    elif up:
        why.append("The price is above its long-term average.")
    else:
        why.append("The long-term trend is still pointing down.")
    if -0.15 <= d <= -0.03 and up:
        why.append(f"It has pulled back {abs(d)*100:.0f}% from its 1-year high, so it is a little cheaper than recently.")
    if level == "low":
        why.append("Its price usually moves calmly, which suits careful investors.")
    risk = [f"If the market turns down, the stock could fall to the safety exit ({sc_row['stop_pct']*100:.1f}% below today)."]
    if meta["market"] == "EGX":
        risk.append("A weaker Egyptian pound can shake Egyptian shares.")
    if level != "low":
        risk.append("The price moves a lot, so keep the amount small.")
    if rsi > 70:
        risk.append("It rose fast lately and may cool down first.")
    return checks, " ".join(why), " ".join(risk)


# --------------------------------------------------------------- report ----

def summarize(sigs: list[dict]) -> dict:
    def rate(xs):
        return round(100 * sum(1 for x in xs if x["result"] == "win") / len(xs)) if xs else None

    closed = [s for s in sigs if s.get("result") in ("win", "loss")]
    by_tier = {t: {"rate": rate([s for s in closed if s["tier"] == t]),
                   "n": len([s for s in closed if s["tier"] == t])} for t, _ in TIERS}
    by_market = {m: {"rate": rate([s for s in closed if s["market"] == m]),
                     "n": len([s for s in closed if s["market"] == m])} for m in MARKET_NAME}
    buckets = [("45-60", 45, 60), ("60-70", 60, 70), ("70-80", 70, 80), ("80+", 80, 101)]
    calib = [{"label": b, "rate": rate([s for s in closed if lo <= s["score"] < hi]),
              "n": len([s for s in closed if lo <= s["score"] < hi])} for b, lo, hi in buckets]
    wins = [s["ret"] for s in closed if s["ret"] > 0]
    losses = [s["ret"] for s in closed if s["ret"] <= 0]
    picks = [s for s in closed if s["tier"] in ("High", "Good")]
    return {
        "closed": len(closed),
        "open": len([s for s in sigs if s.get("result") == "open"]),
        "hit_rate": rate(closed),
        "by_tier": by_tier, "by_market": by_market, "calibration": calib,
        "avg_win": round(100 * float(np.mean(wins)), 1) if wins else None,
        "avg_loss": round(100 * float(np.mean(losses)), 1) if losses else None,
        "avg_pick": round(100 * float(np.mean([s["ret"] for s in picks])), 2) if picks else None,
    }


def grade(rep: dict, edge: float | None) -> tuple[str, str]:
    h = rep["by_tier"]["High"]["rate"]
    if h is None:
        return "–", "Not enough finished predictions yet to grade the app."
    beats = edge is not None and edge > 0
    g = "A" if h >= 70 and beats else "B+" if h >= 62 and beats else "B" if h >= 55 else "C" if h >= 45 else "D"
    words = f"High chance picks were right {h}% of the time"
    if edge is not None:
        words += f" and {'beat' if beats else 'trailed'} simply holding the market by {abs(edge):.1f} points per pick"
    return g, words + "."


# ---------------------------------------------------------------- email ----

def send_emails(events: list[dict], site_url: str) -> None:
    import requests

    key = os.environ.get("BREVO_API_KEY", "").strip()
    sender = os.environ.get("SENDER_EMAIL", "").strip()
    if not events:
        print("No new alerts today, no email sent.")
        return
    if not key or not sender:
        print("Email is not set up yet (BREVO_API_KEY or SENDER_EMAIL missing). Skipping email.")
        return
    headers = {"api-key": key, "accept": "application/json", "content-type": "application/json"}

    people = set(e.strip().lower() for e in os.environ.get("ALERT_EMAILS", "").split(",") if "@" in e)
    list_id = os.environ.get("BREVO_LIST_ID", "").strip()
    if list_id:
        offset = 0
        while True:
            r = requests.get(f"https://api.brevo.com/v3/contacts/lists/{list_id}/contacts",
                             headers=headers, params={"limit": 500, "offset": offset}, timeout=30)
            if r.status_code != 200:
                print("Could not read the subscriber list:", r.status_code, r.text[:200])
                break
            batch = r.json().get("contacts", [])
            people |= {c["email"].lower() for c in batch if not c.get("emailBlacklisted")}
            if len(batch) < 500:
                break
            offset += 500
    if not people:
        print("No subscribers yet. Skipping email.")
        return

    buys = [e for e in events if e["type"] == "buy"]
    sells = [e for e in events if e["type"] in ("target", "stop")]
    subject = (f"{len(buys)} new High chance pick{'s' if len(buys) != 1 else ''}" if buys else "Time to sell") \
        + (f" and {len(sells)} sell alert{'s' if len(sells) != 1 else ''}" if buys and sells else "")
    rows = "".join(
        f"<tr><td style='padding:10px 0;border-bottom:1px solid #1f3a2c'><b style='color:#e8f3ec'>{e['title']}</b><br>"
        f"<span style='color:#9fb8a9'>{e['text']}</span></td></tr>" for e in buys + sells)
    html = f"""<div style="background:#07140e;padding:24px;font-family:Arial,sans-serif;color:#e8f3ec">
<div style="max-width:560px;margin:auto;background:#0d1f16;border-radius:14px;padding:24px">
<div style="background:#f2b544;color:#1a1200;font-size:12px;font-weight:bold;text-align:center;padding:6px;border-radius:6px">TEST MODE · PRETEND MONEY ONLY</div>
<h2 style="color:#34d27b;margin:18px 0 6px">Stock Advisor: today's alerts</h2>
<table style="width:100%;border-collapse:collapse">{rows}</table>
<p style="margin-top:18px"><a href="{site_url}" style="background:#34d27b;color:#05160d;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Open the app</a></p>
<p style="color:#7d9787;font-size:12px;margin-top:22px">For education and practice only. Not financial advice. Past results do not guarantee future returns.
Prices may be delayed or wrong. You received this because you signed up on the Stock Advisor trial website.
To stop these emails, reply with the word STOP.</p></div></div>"""
    sent = 0
    for p in sorted(people):
        r = requests.post("https://api.brevo.com/v3/smtp/email", headers=headers, timeout=30, json={
            "sender": {"name": "Stock Advisor", "email": sender},
            "to": [{"email": p}], "replyTo": {"email": sender},
            "subject": subject, "htmlContent": html})
        if r.status_code in (200, 201, 202):
            sent += 1
        else:
            print("  ! email failed for one subscriber:", r.status_code, r.text[:200])
    print(f"Sent alerts to {sent} of {len(people)} subscribers.")


# ----------------------------------------------------------------- main ----

def r2(x, nd=2):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(float(x), nd)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", action="store_true", help="use made-up prices (testing only)")
    ap.add_argument("--no-email", action="store_true")
    args = ap.parse_args()

    STOCK_DIR.mkdir(parents=True, exist_ok=True)
    universe = load_universe()
    today = dt.datetime.now(dt.timezone.utc)
    log_path = DATA / "signals_log.json"
    log = json.loads(log_path.read_text()) if log_path.exists() else {"started": None, "signals": []}
    if args.sample:  # never mix test data into the real track record
        log = {"started": None, "signals": []}
    alerts_path = DATA / "alerts.json"
    feed = json.loads(alerts_path.read_text()).get("events", []) if alerts_path.exists() else []
    if args.sample or (alerts_path.exists() and json.loads(alerts_path.read_text()).get("sample")):
        feed = []

    stocks, all_bt, failed, frames, new_events = [], [], [], {}, []
    for k, row in enumerate(universe):
        print(f"[{k+1}/{len(universe)}] {row['symbol']} ({row['market']})")
        if args.sample:
            df, ticker = fake_prices(row, k), row["symbol"] + SUFFIXES[row["market"]][0]
        else:
            df, ticker = fetch_yahoo(row)
        if df is None:
            failed.append(f"{row['symbol']} ({MARKET_NAME[row['market']]})")
            continue
        frames[row["symbol"]] = df
        ind = indicators(df)
        sc = rule_score(ind)
        bt = backtest(df, sc, row)
        all_bt += bt

        last, prev = ind.iloc[-1], ind.iloc[-2]
        s_last = sc.iloc[-1]
        score = None if math.isnan(s_last["score"]) else int(s_last["score"])
        tier = tier_of(score)
        checks, why, risk_words = checks_and_words(last, s_last, row)
        same = [b for b in bt if b["tier"] == tier] if tier else []
        hist = {"wins": sum(1 for b in same if b["result"] == "win"), "total": len(same)}

        cur = CURRENCY[row["market"]]
        close = float(last["close"])
        stocks.append({
            "symbol": row["symbol"], "yahoo": ticker, "name": row["name"], "market": row["market"],
            "marketName": MARKET_NAME[row["market"]], "sector": row["sector"], "currency": cur,
            "date": df.index[-1].strftime("%Y-%m-%d"),
            "close": r2(close, 3), "chg1d": r2((close / prev["close"] - 1) * 100),
            "score": score, "tier": tier,
            "parts": {k2: r2(s_last[k2], 0) for k2 in ("trend", "momentum", "calm", "position")},
            "targetPct": r2(s_last["target_pct"] * 100, 1), "stopPct": r2(s_last["stop_pct"] * 100, 1),
            "target": r2(close * (1 + s_last["target_pct"]), 3), "stop": r2(close * (1 - s_last["stop_pct"]), 3),
            "risk": risk_of(last["vol"]), "vol": r2(last["vol"] * 100, 0),
            "checks": checks, "why": why, "whatCouldGoWrong": risk_words, "pastSetups": hist,
            "spark": [r2(x, 3) for x in df["Close"].iloc[-90:].tolist()],
        })

        # Detail file: weekly prices, yearly returns, biggest fall, dividends.
        wk = df["Close"].resample("W-FRI").last().dropna()
        years = df["Close"].groupby(df.index.year).agg(["first", "last"])
        yearly = {int(y): r2((v["last"] / v["first"] - 1) * 100, 1) for y, v in years.iterrows()}
        dd5 = (df["Close"] / df["Close"].cummax() - 1).min()
        div_years = int((df["Dividends"].groupby(df.index.year).sum() > 0).sum()) if "Dividends" in df else 0
        (STOCK_DIR / f"{row['symbol']}.json").write_text(json.dumps({
            "symbol": row["symbol"], "weekly": [[d.strftime("%Y-%m-%d"), r2(v, 3)] for d, v in wk.items()],
            "daily": [[d.strftime("%Y-%m-%d"), r2(v, 3)] for d, v in df["Close"].iloc[-260:].items()],
            "yearly": yearly, "biggestFall": r2(dd5 * 100, 1),
            "growth5y": r2(df["Close"].iloc[-1] / df["Close"].iloc[0], 3),
            "dividendYears": div_years, "years": len(yearly),
        }, separators=(",", ":")))

    if not stocks:
        sys.exit("No prices downloaded at all. The data source may be down; the website keeps yesterday's data.")

    # ---- live track record: update open picks, then add today's new ones
    by_sym = {s["symbol"]: s for s in stocks}
    for sig in log["signals"]:
        if sig["result"] != "open" or sig["symbol"] not in frames:
            continue
        df = frames[sig["symbol"]]
        idx = df.index.searchsorted(pd.Timestamp(sig["date"]))
        if idx >= len(df):
            continue
        status, j, px = evaluate(df, idx, sig["entry"], sig["targetPct"] / 100, sig["stopPct"] / 100)
        if status != "open":
            sig.update(result=status, exit_date=df.index[j].strftime("%Y-%m-%d"),
                       exit_price=r2(px, 3), ret=round(px / sig["entry"] - 1, 4))
            hit_target = px >= sig["entry"] * (1 + sig["targetPct"] / 100) * 0.999
            hit_stop = px <= sig["entry"] * (1 - sig["stopPct"] / 100) * 1.001
            kind = "target" if hit_target else "stop" if hit_stop else "expired"
            st = by_sym.get(sig["symbol"], {})
            cur = st.get("currency", "")
            title = {"target": f"Target reached: time to sell {sig['name']}",
                     "stop": f"Safety exit: time to sell {sig['name']}",
                     "expired": f"Time is up for {sig['name']}"}[kind]
            text = (f"Picked on {sig['date']} at {cur} {sig['entry']:,.2f} ({sig['tier']} chance). "
                    f"Now {cur} {px:,.2f}, {100*(px/sig['entry']-1):+.1f}%.")
            ev = {"id": f"{sig['id']}-{kind}", "date": sig["exit_date"], "type": kind,
                  "symbol": sig["symbol"], "tier": sig["tier"], "title": title, "text": text}
            feed.insert(0, ev)
            if sig["tier"] in ("High", "Good") and kind != "expired":
                new_events.append(ev)

    open_syms = {s["symbol"] for s in log["signals"] if s["result"] == "open"}
    known_ids = {s["id"] for s in log["signals"]}
    for st in stocks:
        if not st["tier"] or st["symbol"] in open_syms:
            continue
        sid = f"{st['symbol']}-{st['date']}"
        if sid in known_ids:
            continue
        log["signals"].append({
            "id": sid, "symbol": st["symbol"], "name": st["name"], "market": st["market"],
            "tier": st["tier"], "score": st["score"], "date": st["date"], "entry": st["close"],
            "targetPct": st["targetPct"], "stopPct": st["stopPct"], "result": "open"})
        cur = st["currency"]
        ev = {"id": f"{sid}-new", "date": st["date"], "type": "buy" if st["tier"] == "High" else "new",
              "symbol": st["symbol"], "tier": st["tier"],
              "title": f"New {st['tier']} chance: {st['name']}",
              "text": f"Scored {st['score']} out of 100 at {cur} {st['close']:,.2f}. "
                      f"Target {cur} {st['target']:,.2f}, safety exit {cur} {st['stop']:,.2f}."}
        feed.insert(0, ev)
        if st["tier"] == "High":
            new_events.append(ev)
    if log["signals"] and not log["started"]:
        log["started"] = today.strftime("%Y-%m-%d")

    # ---- market baseline: the average 40-day move of every watched stock
    base = []
    for df in frames.values():
        c = df["Close"].values
        if len(c) > 252 + HORIZON:
            base += list(c[252 + HORIZON:] / c[252:-HORIZON] - 1)
    market_avg = round(100 * float(np.mean(base)), 2) if base else None

    bt_rep = summarize(all_bt)
    live_rep = summarize([{**s, "ret": s.get("ret", 0)} for s in log["signals"]])
    edge_bt = None if bt_rep["avg_pick"] is None or market_avg is None else bt_rep["avg_pick"] - market_avg
    edge_live = None if live_rep["avg_pick"] is None or market_avg is None else live_rep["avg_pick"] - market_avg
    g_bt, words_bt = grade(bt_rep, edge_bt)
    g_live, words_live = grade(live_rep, edge_live)
    days_live = (today.date() - dt.date.fromisoformat(log["started"])).days if log["started"] else 0
    h_live = live_rep["by_tier"]["High"]["rate"]
    ready = [
        {"ok": h_live is not None and h_live > 60, "text": "High chance picks right more than 60% of the time"
                                                           + (f" ({h_live}% so far)" if h_live is not None else "")},
        {"ok": edge_live is not None and edge_live > 0, "text": "Beats simply holding the market"},
        {"ok": live_rep["closed"] >= 200, "text": f"200 finished predictions ({live_rep['closed']} so far)"},
        {"ok": days_live >= 182, "text": f"6 months of testing ({days_live / 30.4:.1f} so far)"},
    ]

    counts = {t: sum(1 for s in stocks if s["tier"] == t) for t, _ in TIERS}
    meta = {"updated": today.strftime("%Y-%m-%dT%H:%M:%SZ"), "sample": args.sample,
            "checked": len(stocks), "failed": failed, "counts": counts}
    stocks.sort(key=lambda s: -(s["score"] or 0))
    (DATA / "picks.json").write_text(json.dumps({"meta": meta, "stocks": stocks}, separators=(",", ":")))
    (DATA / "report.json").write_text(json.dumps({
        "meta": meta, "marketAvg": market_avg,
        "backtest": {**bt_rep, "grade": g_bt, "words": words_bt, "edge": r2(edge_bt),
                     "from": min((b["date"] for b in all_bt), default=None)},
        "live": {**live_rep, "grade": g_live, "words": words_live, "edge": r2(edge_live),
                 "started": log["started"], "days": days_live},
        "ready": ready,
    }, separators=(",", ":")))
    (DATA / "backtest_signals.json").write_text(json.dumps(all_bt[-3000:], separators=(",", ":")))
    if not args.sample:  # sample runs never touch the real track record
        log_path.write_text(json.dumps(log, indent=1))
    alerts_path.write_text(json.dumps({"sample": args.sample, "events": feed[:150]}, separators=(",", ":")))

    print(f"Checked {len(stocks)} stocks. High {counts['High']}, Good {counts['Good']}, Weak {counts['Weak']}.")
    if failed:
        print("Could not get prices for:", ", ".join(failed))
    if not args.no_email and not args.sample:
        site = os.environ.get("SITE_URL", "")
        send_emails(new_events, site)


if __name__ == "__main__":
    main()
