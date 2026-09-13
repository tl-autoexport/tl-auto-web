# TL Auto Encar queue on VPS

The worker reads the existing `chestny_prigon` catalog in the TL Auto Supabase
database and checks each listing through Encar detail API. It does not import
the Encar search catalog and does not write to the Chesty database.

## Install on the TL Auto VPS

Run as a deployment administrator, after the project is available at
`/home/ubuntu/tl-auto` and `/home/ubuntu/tl-auto/.env` contains the TL Auto Supabase variables
and Encar headers if required:

```bash
sudo install -m 0644 deploy/tl-auto-encar-queue.service /etc/systemd/system/tl-auto-encar-queue.service
sudo install -m 0644 deploy/tl-auto-encar-queue.timer /etc/systemd/system/tl-auto-encar-queue.timer
sudo systemctl daemon-reload
sudo systemctl enable --now tl-auto-encar-queue.timer
```

The TL Auto service uses `/tmp/tl-auto-chestny-encar.lock`. Add the same
non-waiting lock wrapper to the Chesty availability service on the VPS. This
is a systemd-only change; the Chesty project code does not need to change:

```bash
sudo systemctl edit catalog-availability-monitor.service
```

Add:

```ini
[Service]
ExecStart=
ExecStart=/usr/bin/flock -n /tmp/tl-auto-chestny-encar.lock /usr/bin/npm run catalog:monitor
```

Then reload both services:

```bash
sudo systemctl daemon-reload
sudo systemctl restart catalog-availability-monitor.timer
sudo systemctl restart tl-auto-encar-queue.timer
```

The timer expression is in VPS UTC: `13:00` and `19:00 UTC`, which are
`22:00` and `04:00` in Seoul. A busy lock makes the waiting project exit
without interrupting the project that is already running.

## First controlled run

Before enabling the 500-item schedule, run a 10-item write test:

```bash
sudo -u tl-auto env TL_AUTO_ENCAR_BATCH_SIZE=10 TL_AUTO_ENCAR_DELAY_MS=1500 npm run check:encar:queue:write
```

Inspect status and logs:

```bash
systemctl list-timers tl-auto-encar-queue.timer
systemctl status tl-auto-encar-queue.service
journalctl -u tl-auto-encar-queue.service -n 100 --no-pager
```

The timer has `Persistent=true`, so a missed run is started after the VPS
returns. `RandomizedDelaySec` avoids making the request burst coincide exactly
with other projects. The worker lock prevents a second TL Auto run from
starting while the first is still processing.

After a successful Encar check, recalculate published TL Auto prices in a
separate controlled job; the worker updates `price_krw`, while `price_rub` is
derived by the catalog recalculation process.
