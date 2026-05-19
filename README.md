# SmartPillBox

IoT smart pill dispenser with ESP32, Google Apps Script backend, and web dashboard.

## Features

- **Automated Dispensing** — ESP32-controlled stepper motor rotates the pill tray; servo opens the lid at scheduled times
- **Web Dashboard** — Manage 4 pill slots (medication name, time, ON/OFF), view 7-day adherence chart, monitor temperature/humidity
- **AI Assistant** — Gemini 2.5 Flash-powered chat for medication questions
- **Hardware Alerts** — LED + buzzer notify the user when it's time to take pills; TAKE / SKIP buttons for logging

## Project Structure

```
backend/            — Google Apps Script (code.gs) + cloudCode backup
firmware/           — ESP32 Arduino firmware (.ino)
web/                — Web dashboard (index.html)
hardware/
  models/           — 3D printable models (OBJ, 3MF, G-code)
  circuit/          — Fritzing diagram + wiring screenshots
docs/images/        — UI screenshots
```

## Hardware

- **MCU:** ESP32 DOIT DevKit
- **Sensors:** DHT11 (temperature / humidity)
- **Actuators:** 28BYJ-48 stepper motor, SG90 servo
- **Interface:** LED, buzzer, 2x buttons (TAKE / SKIP)

## How It Works

1. ESP32 polls Google Sheets every 3 seconds for pending commands
2. When a scheduled time matches, it rotates the tray to the correct slot
3. LED + buzzer alert the user; pressing TAKE opens the servo lid, SKIP dismisses
4. All events (taken / skipped) are logged back to the sheet
5. The web dashboard displays real-time adherence stats and environment data
