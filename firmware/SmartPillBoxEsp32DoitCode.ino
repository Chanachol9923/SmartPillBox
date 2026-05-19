#include <WiFi.h>
#include <HTTPClient.h>
#include <ESP32Servo.h>
#include <Stepper.h>
#include "DHT.h"

// --- Config ---
const char* ssids[] = {"qog", "q2g"}; // รายชื่อ WiFi
const char* password = "0909909923";
String scriptURL = "https://script.google.com/macros/s/AKfycbyGw57N35BZMztmem6VCHCKJEOiaRvxfScfrKcPCqEtqGAhKUXnzam9tKqj9XGT_pY/exec";

#define DHTPIN 4 
#define DHTTYPE DHT11
DHT dht(DHTPIN, DHTTYPE);

const int stepsPerRevolution = 2048; 
Stepper myStepper(stepsPerRevolution, 19, 5, 18, 17); 
Servo myServo;
String lastProcessedMinute = "";
const int LED_PIN = 2;
const int BUZZER_PIN = 12;
const int BTN_TAKE = 25;
const int BTN_SKIP = 26;

bool isLidOpen = false; 

void setup() {
  Serial.begin(115200);
  dht.begin();
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(BTN_TAKE, INPUT_PULLUP);
  pinMode(BTN_SKIP, INPUT_PULLUP);
  
  myStepper.setSpeed(12);
  myServo.attach(13);
  myServo.write(120); 

  connectWiFi(); // ใช้ฟังก์ชันเชื่อมต่อใหม่
}

void connectWiFi() {
  int currentWiFi = 0;
  int maxAttemptsPerSSID = 15; // ลองเชื่อมต่อ SSID ละประมาณ 7.5 วินาที

  while (WiFi.status() != WL_CONNECTED) {
    // 1. ตัดการเชื่อมต่อเก่าออกก่อนเพื่อความสะอาด
    WiFi.disconnect();
    delay(500);

    Serial.print("\nAttempting to connect to: ");
    Serial.println(ssids[currentWiFi]);
    
    WiFi.begin(ssids[currentWiFi], password);
    
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < maxAttemptsPerSSID) {
      digitalWrite(LED_PIN, !digitalRead(LED_PIN)); // กะพริบไฟเร็วๆ ตอนกำลังพยายามต่อ
      delay(500);
      Serial.print(".");
      attempts++;
    }
    
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("\nFailed to connect to " + String(ssids[currentWiFi]));
      currentWiFi = (currentWiFi + 1) % 2; // สลับไปอีกตัว (0 เป็น 1 หรือ 1 เป็น 0)
      Serial.println("Switching to next SSID...");
    }
  }
  
  // เชื่อมต่อสำเร็จ
  digitalWrite(LED_PIN, HIGH);
  tone(BUZZER_PIN, 1500, 100); delay(150);
  tone(BUZZER_PIN, 2000, 100);
  Serial.println("\nWiFi Connected Success!");
  Serial.println("Connected to: " + String(ssids[currentWiFi]));
  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    checkCommand();
    static unsigned long lastEnvUpdate = 0;
    if (millis() - lastEnvUpdate > 20000) { // ส่งข้อมูลแวดล้อมทุก 20 วินาที (ประหยัดโควตา)
      sendEnvironmentData();
      lastEnvUpdate = millis();
    }
  } else {
    connectWiFi();
  }
  delay(3000); // Polling ทุก 3 วินาทีเพื่อให้ทันใจตอนกดปุ่มในเว็บ
}

void checkCommand() {
  HTTPClient http;
  String url = scriptURL + "?type=check_command";
  http.begin(url.c_str());
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  
  int httpCode = http.GET();
  if (httpCode > 0) {
    String payload = http.getString();
    payload.trim();
    if (payload != "") {
      Serial.println(">>> New Command: " + payload);
      
      // แยกตัวเลข Slot (รองรับคำสั่ง slotX-...)
      int slot = payload.substring(4, 5).toInt();
      
      if (payload.indexOf("-refill-open") > -1) {
        handleRefillOpen(slot);
      } else if (payload.indexOf("-request") > -1) {
        handlePillSequence(slot);
      }
    }
  }
  http.end();
}

void handlePillSequence(int slot) {
  // --- 🚨 ส่วนที่เพิ่ม: กันรันซ้ำในนาทีเดียวกัน (นาทีนึงรันได้แค่ครั้งเดียว) ---
  static unsigned long lastTriggerTime = 0;
  if (millis() - lastTriggerTime < 60000 && lastTriggerTime != 0) { 
      Serial.println("Skipping: Already triggered in this minute (Local Lock).");
      return; 
  }
  lastTriggerTime = millis();
  // ------------------------------------------------------------------

  Serial.println("Action: Dispensing Slot " + String(slot));
  myStepper.step(512 * (slot - 1)); // หมุนถาดไปยัง Slot ที่ต้องการ
  
  unsigned long pillStartTime = millis();
  int skipConfirm = 0;
  isLidOpen = false; 

  while (true) {
    alert(skipConfirm); // ส่งเสียงแจ้งเตือน
    
    // --- ปุ่มยืนยันการกินยา (BTN_TAKE) ---
    if (digitalRead(BTN_TAKE) == LOW) {
      delay(300); // Debounce
      if (!isLidOpen) {
        myServo.write(65); // สั่งเปิดฝา
        isLidOpen = true;
        tone(BUZZER_PIN, 1500, 100);
      } else {
        myServo.write(120); // สั่งปิดฝา
        isLidOpen = false;
        sendLog(slot, "Taken"); // บันทึกลง Google Sheets
        break;
      }
    }

    // --- ปุ่มข้ามการกินยา (BTN_SKIP) ---
    if (digitalRead(BTN_SKIP) == LOW) {
      delay(300);
      if (isLidOpen) { 
        // ถ้าเปิดฝาอยู่แล้วดันกดข้าม ให้ถือว่ากินแล้วและสั่งปิดฝา (Safety Feature)
        myServo.write(120); 
        isLidOpen = false;
        sendLog(slot, "Taken");
        break;
      } else {
        // ถ้ายังไม่เปิดฝา ต้องกด 2 ครั้งเพื่อยืนยันการข้าม
        skipConfirm++;
        if (skipConfirm >= 2) { 
          sendLog(slot, "Skip"); 
          break; 
        }
      }
    }

    // --- Timeout 1 นาที (ถ้าเงียบหายไปเลย) ---
    if (millis() - pillStartTime > 60000 && !isLidOpen) {
      sendLog(slot, "Skip"); 
      break;
    }
    delay(10);
  }

  myStepper.step(-(512 * (slot - 1))); // หมุนถาดกลับมาจุดเริ่มต้น
  digitalWrite(LED_PIN, LOW); 
  noTone(BUZZER_PIN);
}

void handleRefillOpen(int slot) {
  Serial.println("Action: Manual Refill Slot " + String(slot));
  myStepper.step(512 * (slot - 1));
  delay(500);
  myServo.write(65); 
  isLidOpen = true;
  tone(BUZZER_PIN, 1800, 200);

  while (true) {
    digitalWrite(LED_PIN, (millis() / 800) % 2); // กะพริบแจ้งเตือนว่าเปิดฝาค้างไว้
    if (digitalRead(BTN_TAKE) == LOW || digitalRead(BTN_SKIP) == LOW) {
      delay(300);
      myServo.write(120);
      isLidOpen = false;
      tone(BUZZER_PIN, 1000, 200);
      break; 
    }
    delay(10);
  }
  myStepper.step(-(512 * (slot - 1)));
  digitalWrite(LED_PIN, LOW);
}

void alert(int mode) {
  if (mode == 0) {
    digitalWrite(LED_PIN, (millis() / 500) % 2);
    if ((millis() % 2000) < 50) tone(BUZZER_PIN, 1200, 30);
  } else {
    int cycle = millis() % 1000;
    bool blink = (cycle < 150 || (cycle > 300 && cycle < 450));
    digitalWrite(LED_PIN, blink);
    if (blink && (millis() % 150 < 30)) tone(BUZZER_PIN, 1500, 20);
  }
}

void sendEnvironmentData() {
  float h = dht.readHumidity();
  float t = dht.readTemperature();
  if (isnan(h) || isnan(t)) return;
  HTTPClient http;
  String url = scriptURL + "?type=env_log&temp=" + String(t) + "&humi=" + String(h);
  http.begin(url.c_str());
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  http.GET(); 
  http.end();
  Serial.println("Env Updated: " + String(t) + "C");
}

void sendLog(int slot, String action) {
  HTTPClient http;
  String url = scriptURL + "?type=log&slot=" + String(slot) + "&action=" + action;
  http.begin(url.c_str());
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  http.GET(); 
  http.end();
  Serial.println("Log Sent: Slot " + String(slot) + " " + action);
}