"""Send one test alert email, built from today's top High chance picks.

Run by hand from GitHub: Actions -> Send test email -> Run workflow.
Goes to everyone on the Brevo list, plus ALERT_EMAILS. If nobody has signed up yet,
it goes to SENDER_EMAIL so you can see what an alert looks like.
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from analyze import DATA, send_emails  # noqa: E402

picks = json.loads((DATA / "picks.json").read_text())["stocks"]
high = [s for s in picks if s.get("tier") == "High"][:3]
if not high:
    print("No High chance picks in today's data, so there is nothing to show in a test email.")
    sys.exit(0)

events = []
for st in high:
    cur = st["currency"]
    events.append({
        "type": "buy",
        "title": f"TEST: High chance: {st['name']}",
        "text": f"Scored {st['score']} out of 100 at {cur} {st['close']:,.2f}. "
                f"Target {cur} {st['target']:,.2f}, safety exit {cur} {st['stop']:,.2f}. "
                "This is a test email, sent by hand.",
    })

if not os.environ.get("ALERT_EMAILS", "").strip():
    os.environ["ALERT_EMAILS"] = os.environ.get("SENDER_EMAIL", "")
send_emails(events, os.environ.get("SITE_URL", ""))
