# Stock Advisor (trial website)

A practice stock coach for the Egyptian Exchange (EGX), Abu Dhabi (ADX) and Dubai (DFM). Pretend money only. **Not financial advice.**

- **Website** (`docs/`): plain HTML, CSS and JavaScript. Hosted free on GitHub Pages. Screens: Welcome, Risk quiz, Home, Today's picks, Stock detail, Pretend buy, My stocks, History, Accuracy report, Alerts (email sign-up), Explore, Me (risk meter).
- **Evening engine** (`engine/analyze.py`): runs on GitHub Actions every evening. It downloads 5 years of daily prices from Yahoo Finance, scores each stock 0 to 100 (trend, momentum, calmness, distance from its 1-year high), sets a target and a safety exit, replays the rules over the past 5 years, keeps a live track record, and writes JSON into `docs/data/`.
- **Email alerts**: subscribers sign up through a Brevo form. The engine emails new High chance picks and time-to-sell moments through Brevo's free plan.

Tiers: **High** 75+, **Good** 60 to 74, **Weak** 45 to 59 (watch only). Suggested amounts depend on your quiz result (Careful, Balanced or Bold) and the "most in one stock" limit.

Setup: see **SETUP-GUIDE.md**.

To test without internet prices: `pip install -r engine/requirements.txt`, then `python engine/analyze.py --sample` (made-up prices, shown with a red SAMPLE DATA banner; it never touches the real track record). Then serve `docs/` with `python -m http.server --directory docs` and open http://localhost:8000.
# stock-advisor
Practice stock coach for Egypt and UAE (trial, pretend money, not financial advice)
