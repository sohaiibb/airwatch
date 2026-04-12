"""
AirWatch Alert Engine — detects NCEC exceedances, manages alert state,
queues notifications. Email sending is a placeholder until configured.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional


POLLUTANT_LABELS = {
    "pm25": "PM2.5", "pm10": "PM10", "so2": "SO2",
    "no2": "NO2", "o3": "O3", "co": "CO",
}

# NCEC rules: period_hours used to compute the rolling average
NCEC_RULES = [
    {"pollutant": "pm25", "period_hours": 24, "limit": 35,    "period_label": "24-hour"},
    {"pollutant": "pm10", "period_hours": 24, "limit": 340,   "period_label": "24-hour"},
    {"pollutant": "so2",  "period_hours": 1,  "limit": 441,   "period_label": "1-hour"},
    {"pollutant": "so2",  "period_hours": 24, "limit": 217,   "period_label": "24-hour"},
    {"pollutant": "no2",  "period_hours": 1,  "limit": 200,   "period_label": "1-hour"},
    {"pollutant": "o3",   "period_hours": 8,  "limit": 157,   "period_label": "8-hour"},
    {"pollutant": "co",   "period_hours": 1,  "limit": 40000, "period_label": "1-hour"},
    {"pollutant": "co",   "period_hours": 8,  "limit": 10000, "period_label": "8-hour"},
]

DAILY_CAP = 24  # max notifications per station per day


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _parse_ts(ts_str: str) -> datetime:
    """Parse ISO timestamp from Supabase (may or may not have Z)."""
    s = ts_str.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        return datetime.fromisoformat(s.split("+")[0]).replace(tzinfo=timezone.utc)


class AlertEngine:

    def __init__(self, sb):
        self.sb = sb

    # ─── Data helpers ──────────────────────────────────────────────────────────

    def compute_average(self, station_id: str, pollutant: str, hours: int) -> Optional[float]:
        since = (_utcnow() - timedelta(hours=hours)).isoformat()
        try:
            res = (self.sb.table("readings")
                   .select(pollutant)
                   .eq("station_id", station_id)
                   .gte("timestamp", since)
                   .execute())
            vals = [float(row[pollutant]) for row in (res.data or [])
                    if row.get(pollutant) is not None]
            return round(sum(vals) / len(vals), 3) if vals else None
        except Exception as e:
            print(f"[AlertEngine] compute_average({pollutant},{hours}h): {e}")
            return None

    def get_active_event(self, station_id: str, pollutant: str, period: str) -> Optional[dict]:
        try:
            res = (self.sb.table("alert_events")
                   .select("*")
                   .eq("station_id", station_id)
                   .eq("pollutant", pollutant)
                   .eq("period", period)
                   .neq("status", "cleared")
                   .order("created_at", desc=True)
                   .limit(1)
                   .execute())
            return res.data[0] if res.data else None
        except Exception as e:
            print(f"[AlertEngine] get_active_event error: {e}")
            return None

    def get_rules(self, station_id: str) -> list:
        try:
            # Global rules (station_id IS NULL)
            g = (self.sb.table("alert_rules")
                 .select("*")
                 .is_("station_id", "null")
                 .eq("enabled", True)
                 .execute())
            rules = {(r["pollutant"], r["period"]): r for r in (g.data or [])}

            # Station-specific overrides
            s = (self.sb.table("alert_rules")
                 .select("*")
                 .eq("station_id", station_id)
                 .eq("enabled", True)
                 .execute())
            for r in (s.data or []):
                rules[(r["pollutant"], r["period"])] = r

            return list(rules.values())
        except Exception as e:
            print(f"[AlertEngine] get_rules error: {e}")
            # Fallback to hardcoded
            return [{"pollutant": r["pollutant"], "period": r["period_label"],
                     "threshold": r["limit"], "warning_pct": 80, "enabled": True,
                     "id": None}
                    for r in NCEC_RULES]

    def get_daily_notif_count(self, station_id: str) -> int:
        today = _utcnow().date().isoformat()
        try:
            res = (self.sb.table("alert_log")
                   .select("id", count="exact")
                   .eq("station_id", station_id)
                   .eq("action", "notification_queued")
                   .gte("created_at", today)
                   .execute())
            return res.count or 0
        except:
            return 0

    # ─── Mutators ──────────────────────────────────────────────────────────────

    def create_event(self, station_id, pollutant, period, status, measured, threshold, warning_pct=80) -> dict:
        now = _utcnow().isoformat()
        row = {
            "station_id": station_id, "pollutant": pollutant, "period": period,
            "status": status, "measured_value": round(measured, 2),
            "threshold": threshold, "warning_pct": warning_pct,
            "started_at": now, "last_notified_at": now,
            "peak_value": round(measured, 2), "peak_at": now,
            "hour_count": 1 if status in ("triggered", "ongoing", "escalated") else 0,
            "created_at": now, "updated_at": now,
        }
        res = self.sb.table("alert_events").insert(row).execute()
        return res.data[0] if res.data else row

    def update_event(self, event_id: str, updates: dict):
        updates["updated_at"] = _utcnow().isoformat()
        self.sb.table("alert_events").update(updates).eq("id", event_id).execute()

    def log(self, station_id: str, event_id: Optional[str], action: str, details: dict):
        try:
            self.sb.table("alert_log").insert({
                "station_id": station_id, "event_id": event_id,
                "action": action, "details": details,
                "created_at": _utcnow().isoformat(),
            }).execute()
        except Exception as e:
            print(f"[AlertEngine] log error: {e}")

    # ─── Notification placeholder ───────────────────────────────────────────────

    def send_notification(self, station_name: str, station_id: str,
                          event_id: Optional[str], subject: str,
                          alerts_batch: list, tier: str):
        print(f"\n[AlertEngine] ── NOTIFICATION QUEUED ──")
        print(f"  Station : {station_name}")
        print(f"  Subject : {subject}")
        print(f"  Tier    : {tier}")
        for a in alerts_batch:
            label = POLLUTANT_LABELS.get(a["pollutant"], a["pollutant"])
            print(f"  {label} ({a['period']}): measured={a['measured']:.2f}, limit={a['threshold']}, status={a['status']}")

        # Save to alert_log
        self.log(station_id, event_id, "notification_queued", {
            "subject": subject,
            "tier": tier,
            "station_name": station_name,
            "alerts": alerts_batch,
        })

        # Send push notifications
        try:
            self._send_push(station_id, subject, alerts_batch[0] if alerts_batch else None)
        except Exception as e:
            print(f"[AlertEngine] Push error: {e}")

    def _send_push(self, station_id: str, subject: str, alert: Optional[dict]):
        """Send web push notifications to subscribed users."""
        import os
        vapid_private = os.getenv("VAPID_PRIVATE_KEY", "")
        vapid_email   = os.getenv("VAPID_CONTACT_EMAIL", "mailto:admin@example.com")
        if not vapid_private:
            return  # VAPID not configured, skip push

        try:
            from pywebpush import webpush, WebPushException
            import json as _json
        except ImportError:
            return  # pywebpush not installed

        # Fetch all active push subscriptions
        try:
            res = self.sb.table("push_subscriptions").select("endpoint,p256dh,auth").execute()
            subs = res.data or []
        except Exception:
            return

        if not subs:
            return

        pollutant = alert.get("pollutant", "") if alert else ""
        label = POLLUTANT_LABELS.get(pollutant, pollutant).upper()
        measured = alert.get("measured", 0) if alert else 0
        threshold = alert.get("threshold", 0) if alert else 0
        status = alert.get("status", "triggered") if alert else "triggered"

        if status == "cleared":
            title = f"\u2705 {label} Normal"
            body  = f"{label} returned to {measured:.1f} \u00b5g/m\u00b3"
        else:
            title = f"\u26a0\ufe0f {label} Exceedance"
            body  = f"{label} reached {measured:.1f} \u00b5g/m\u00b3 (limit: {threshold})"

        payload = _json.dumps({
            "title": title,
            "body": body,
            "tag": f"exceedance-{pollutant}",
        })

        for sub in subs:
            try:
                webpush(
                    subscription_info={
                        "endpoint": sub["endpoint"],
                        "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]},
                    },
                    data=payload,
                    vapid_private_key=vapid_private,
                    vapid_claims={"sub": vapid_email},
                )
            except Exception as e:
                print(f"[Push] Failed for {sub.get('endpoint', '')[:40]}\u2026: {e}")

    def get_subscribers(self, station_id: str) -> list:
        try:
            res = (self.sb.table("alert_subscribers")
                   .select("*")
                   .eq("email_enabled", True)
                   .execute())
            return [s for s in (res.data or [])
                    if s.get("station_id") is None or s.get("station_id") == station_id]
        except Exception as e:
            print(f"[AlertEngine] get_subscribers error: {e}")
            return []

    # ─── Main station check ─────────────────────────────────────────────────────

    def check_station(self, station: dict):
        station_id   = station["id"]
        station_name = station.get("name", station_id)
        now          = _utcnow()
        rules        = self.get_rules(station_id)
        daily_count  = self.get_daily_notif_count(station_id)

        to_notify = []

        for rule in rules:
            pollutant   = rule["pollutant"]
            period      = rule["period"]
            threshold   = float(rule["threshold"])
            warning_pct = int(rule.get("warning_pct") or 80)
            warn_level  = threshold * warning_pct / 100

            # Find NCEC rule to get hours
            ncec = next((r for r in NCEC_RULES
                         if r["pollutant"] == pollutant and r["period_label"] == period), None)
            if not ncec:
                continue
            hours = ncec["period_hours"]

            measured = self.compute_average(station_id, pollutant, hours)
            if measured is None:
                continue

            active = self.get_active_event(station_id, pollutant, period)

            # ── State machine ───────────────────────────────────────────────
            if measured >= threshold:
                if active is None:
                    # New exceedance — Tier 2
                    event = self.create_event(station_id, pollutant, period,
                                              "triggered", measured, threshold, warning_pct)
                    self.log(station_id, event["id"], "state_change",
                             {"from": None, "to": "triggered", "measured": round(measured, 2)})
                    to_notify.append({
                        "event_id": event["id"], "pollutant": pollutant, "period": period,
                        "measured": measured, "threshold": threshold, "status": "triggered",
                        "tier": "exceedance", "hour_count": 1,
                    })
                else:
                    # Ongoing — check if an hour has passed since last notification
                    hours_since_notif = 999.0
                    if active.get("last_notified_at"):
                        hours_since_notif = (now - _parse_ts(active["last_notified_at"])).total_seconds() / 3600

                    peak_updates = {"measured_value": round(measured, 2)}
                    if active.get("peak_value") is None or measured > float(active["peak_value"]):
                        peak_updates["peak_value"] = round(measured, 2)
                        peak_updates["peak_at"]    = now.isoformat()

                    if hours_since_notif >= 1.0:
                        hour_count = (active.get("hour_count") or 1) + 1
                        new_status = "escalated" if hour_count >= 4 else "ongoing"
                        tier       = "escalation" if hour_count >= 4 else "ongoing"
                        peak_updates["status"]           = new_status
                        peak_updates["hour_count"]       = hour_count
                        peak_updates["last_notified_at"] = now.isoformat()
                        self.log(station_id, active["id"], "state_change",
                                 {"from": active["status"], "to": new_status,
                                  "measured": round(measured, 2), "hour_count": hour_count})
                        to_notify.append({
                            "event_id": active["id"], "pollutant": pollutant, "period": period,
                            "measured": measured, "threshold": threshold, "status": new_status,
                            "tier": tier, "hour_count": hour_count,
                            "started_at": active.get("started_at"),
                            "peak_value": peak_updates.get("peak_value") or active.get("peak_value"),
                        })
                    self.update_event(active["id"], peak_updates)

            elif measured >= warn_level:
                # Warning zone
                if active is None:
                    event = self.create_event(station_id, pollutant, period,
                                              "warning", measured, threshold, warning_pct)
                    self.log(station_id, event["id"], "state_change",
                             {"from": None, "to": "warning", "measured": round(measured, 2)})
                    to_notify.append({
                        "event_id": event["id"], "pollutant": pollutant, "period": period,
                        "measured": measured, "threshold": threshold, "status": "warning",
                        "tier": "warning", "hour_count": 0,
                    })
                else:
                    # Still in warning, just update value (no re-notify)
                    self.update_event(active["id"], {"measured_value": round(measured, 2)})

            else:
                # Below warning — clear any active alert
                if active is not None:
                    was_exceeding = active["status"] in ("triggered", "ongoing", "escalated")
                    self.update_event(active["id"], {
                        "status": "cleared",
                        "cleared_at": now.isoformat(),
                        "measured_value": round(measured, 2),
                    })
                    self.log(station_id, active["id"], "state_change",
                             {"from": active["status"], "to": "cleared",
                              "measured": round(measured, 2)})
                    if was_exceeding:
                        duration_hrs = (now - _parse_ts(active["started_at"])).total_seconds() / 3600
                        to_notify.append({
                            "event_id": active["id"], "pollutant": pollutant, "period": period,
                            "measured": measured, "threshold": threshold, "status": "cleared",
                            "tier": "cleared", "hour_count": active.get("hour_count", 0),
                            "started_at": active.get("started_at"),
                            "peak_value": active.get("peak_value"),
                            "duration_hrs": round(duration_hrs, 1),
                        })

        if not to_notify:
            return

        if daily_count >= DAILY_CAP:
            print(f"[AlertEngine] {station_name}: daily cap reached ({daily_count}/{DAILY_CAP}), suppressing {len(to_notify)} notification(s)")
            return

        # Batch all into one notification — sort by tier priority
        tier_priority = {"escalation": 0, "exceedance": 1, "ongoing": 2, "warning": 3, "cleared": 4}
        to_notify.sort(key=lambda x: tier_priority.get(x["tier"], 9))
        top_tier = to_notify[0]["tier"]

        if top_tier == "escalation":
            h = to_notify[0].get("hour_count", 4)
            subject = f"\U0001f534 AirWatch URGENT \u2014 Prolonged Exceedance ({h}h) at {station_name}"
        elif top_tier == "exceedance":
            pols = ", ".join(POLLUTANT_LABELS.get(a["pollutant"], a["pollutant"]) for a in to_notify if a["tier"] == "exceedance")
            subject = f"\u26a0\ufe0f AirWatch Alert \u2014 {pols} Exceedance at {station_name}"
        elif top_tier == "ongoing":
            subject = f"\u26a0\ufe0f AirWatch \u2014 Ongoing Exceedance at {station_name}"
        elif top_tier == "warning":
            pols = ", ".join(POLLUTANT_LABELS.get(a["pollutant"], a["pollutant"]) for a in to_notify if a["tier"] == "warning")
            subject = f"\u26a1 AirWatch Warning \u2014 {pols} Approaching Limit at {station_name}"
        else:
            subject = f"\u2705 AirWatch \u2014 Air Quality Returned to Normal at {station_name}"

        self.send_notification(
            station_name=station_name, station_id=station_id,
            event_id=to_notify[0].get("event_id"),
            subject=subject, alerts_batch=to_notify, tier=top_tier,
        )

    # ─── Run all stations ───────────────────────────────────────────────────────

    def run(self):
        if not self.sb:
            print("[AlertEngine] No Supabase client — skipping alert check")
            return
        try:
            stations = (self.sb.table("stations")
                        .select("id, name")
                        .eq("is_active", True)
                        .execute().data or [])
            print(f"[AlertEngine] Checking {len(stations)} station(s) at {_utcnow().isoformat()}")
            for station in stations:
                try:
                    self.check_station(station)
                except Exception as e:
                    import traceback
                    print(f"[AlertEngine] Error checking {station.get('name')}: {e}")
                    traceback.print_exc()
        except Exception as e:
            print(f"[AlertEngine] run() error: {e}")
