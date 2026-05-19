const GEMINI_API_KEY = "Your_Key";
const SPREADSHEET_ID = "Your_SheetID";

// --- ฟังก์ชันเช็คคำสั่งจาก ESP32 (Polling) ---
// --- แก้ไขฟังก์ชัน doGet เดิม [cite: 74, 76, 81] ---
function doGet(e) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var configSheet = ss.getSheetByName("Config");
  var logSheet = ss.getSheetByName("Logs");
  var envSheet = ss.getSheetByName("Environment");
  var cmdSheet = ss.getSheetByName("Commands") || ss.insertSheet("Commands");

  if (e && e.parameter && e.parameter.type) {
    var type = e.parameter.type;

    if (type == 'check_command') {
      var cmd = cmdSheet.getRange("A1").getValue();
      if (cmd == "") {
        var now = Utilities.formatDate(new Date(), "GMT+7", "HH:mm");
        var data = configSheet.getRange("A2:E5").getValues(); // ดึงถึง Column E [cite: 78, 81]

        for (var i = 0; i < data.length; i++) {
          var slotTime = (data[i][2] instanceof Date) ?
                         Utilities.formatDate(data[i][2], "GMT+7", "HH:mm") : 
                         data[i][2].toString();
          var status = data[i][3];       
          var lastTriggered = data[i][4];

          // เช็คเวลาตรง + สถานะ ON + นาทีนี้ยังไม่เคยสั่งงาน [cite: 81]
          if (now == slotTime && status == "ON" && String(lastTriggered) !== now) {
            configSheet.getRange(i + 2, 5).setValue(now);
            SpreadsheetApp.flush(); // บังคับเขียนข้อมูลลง Sheet ทันทีกัน Race Condition
            cmd = "slot" + data[i][0] + "-request";
            break; 
          }
        }
      } else { 
        cmdSheet.getRange("A1").clearContent();
      }
      return ContentService.createTextOutput(cmd.toString());
    }
    // ... (ส่วน env_log และ log คงเดิม [cite: 84, 85, 86])
  }
  return HtmlService.createHtmlOutputFromFile('index').setTitle('PillBox AI System');
}

// --- แก้ไขฟังก์ชัน updateSettings เดิม [cite: 107] ---
function updateSettings(slot, label, time, status) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName("Config");
  var data = sheet.getRange("A2:C5").getValues(); // ดึงข้อมูล Slot, ชื่อยา และเวลา

  // 1. เตรียมค่าเวลาที่รับมาให้เป็นมาตรฐานเดียวกัน (String และไม่มีช่องว่าง)
  var targetTime = String(time).trim();

  // 2. ตรวจสอบว่าเวลานี้ถูกตั้งไว้ใน Slot อื่นแล้วหรือยัง
  for (var i = 0; i < data.length; i++) {
    var checkSlot = data[i][0];
    var checkTime = data[i][2];

    // แปลงเวลาจาก Sheet ให้เป็น String Format "HH:mm" เพื่อเทียบกับค่าที่รับมา
    var formattedCheckTime = (checkTime instanceof Date) ? 
                             Utilities.formatDate(checkTime, "GMT+7", "HH:mm") : 
                             String(checkTime).trim();

    // ถ้าไม่ใช่ Slot เดิมที่กำลังแก้อยู่ และเวลาดันตรงกันเป๊ะ
    if (String(checkSlot) !== String(slot) && formattedCheckTime === targetTime) {
      return "ERROR: เวลานี้ถูกใช้ใน Slot " + checkSlot + " แล้ว";
    }
  }

  // 3. บันทึกข้อมูลใหม่ลงในตาราง
  var row = parseInt(slot) + 1;
  sheet.getRange(row, 2).setValue(label); // คอลัมน์ B: ชื่อยา
  sheet.getRange(row, 3).setNumberFormat('@').setValue(targetTime); // คอลัมน์ C: เวลา (เก็บเป็น Plain Text)
  sheet.getRange(row, 4).setValue(status.toUpperCase()); // คอลัมน์ D: สถานะ ON/OFF
  sheet.getRange(row, 5).clearContent(); // คอลัมน์ E: ล้างข้อมูล LastTrigger เพื่อให้ทำงานได้ทันทีเมื่อถึงเวลาใหม่
  
  return "OK";
}

function chatWithPillBox(userMessage) {
  // 1. ประกาศตัวแปร apiKey ก่อน (ใช้ Key ของคุณ)
  const apiKey = "AIzaSyDq0BwTcAGHPXWW0qIVDQ_-T2LpcoQ4zrs"; 
  
  // 2. ใช้รูปแบบ apiUrl ตามรูปที่ส่งมา (ปรับเป็นรุ่น 1.5-flash เพื่อความเสถียร)
  // ใช้ gemini-pro ซึ่งเป็นรุ่นมาตรฐานที่สุดสำหรับ v1beta
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const logSheet = ss.getSheetByName("Logs");
  const configSheet = ss.getSheetByName("Config");
  const envSheet = ss.getSheetByName("Environment");

  // ดึงข้อมูลมาทำบริบทให้ AI
  const logs = logSheet.getLastRow() > 1 ? logSheet.getRange(Math.max(1, logSheet.getLastRow()-10), 1, 10, 4).getValues() : "ไม่มีประวัติ";
  const config = configSheet.getRange(2, 1, 4, 3).getValues();
  const lastEnv = envSheet.getLastRow() > 0 ? envSheet.getRange(envSheet.getLastRow(), 2, 1, 2).getValues()[0] : [0,0];

  const prompt = `คุณคือ PillBox AI ผู้ช่วยอัจฉริยะ 
  ข้อมูลปัจจุบัน: ยาที่ตั้งไว้ ${JSON.stringify(config)}, ประวัติล่าสุด: ${JSON.stringify(logs)}, สภาพแวดล้อม: ${lastEnv[0]}°C / ${lastEnv[1]}% RH
  คำถามผู้ใช้: "${userMessage}"
  คำสั่ง: ตอบกลับเป็นภาษาไทยที่สุภาพ เป็นกันเอง กระชับ และวิเคราะห์ภาพรวมการกินยาทุกตัว`;

  const payload = {
    "contents": [{
      "parts": [{ "text": prompt }]
    }]
  };
  
  const options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true 
  };
  
  try {
    const response = UrlFetchApp.fetch(apiUrl, options);
    const resText = response.getContentText();
    const json = JSON.parse(resText);
    
    if (json.candidates && json.candidates[0].content) {
      return json.candidates[0].content.parts[0].text;
    } else {
      return "PillBox Error: " + (json.error ? json.error.message : "โปรดตรวจสอบการตั้งค่า Model");
    }
  } catch (e) {
    return "PillBox: ระบบขัดข้อง (" + e.toString() + ")";
  }
}
// ฟังก์ชันสำรองกรณีโมเดล Flash มีปัญหา
function tryGeminiProBackup(prompt, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent?key=${apiKey}`;
  const payload = { contents: [{ parts: [{ text: prompt }] }] };
  const response = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  const json = JSON.parse(response.getContentText());
  return (json.candidates && json.candidates[0].content) ? json.candidates[0].content.parts[0].text : "PillBox: ขณะนี้ระบบ AI กำลังปรับปรุงชั่วคราว โปรดลองใหม่ภายหลังครับ";
}

// --- Functions สำหรับ Sync หน้าเว็บ ---
function getLatestEnv() {
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("Environment");
  if (sheet.getLastRow() < 1) return { temp: 0, humi: 0 };
  var val = sheet.getRange(sheet.getLastRow(), 2, 1, 2).getValues()[0];
  return { temp: val[0], humi: val[1] };
}

function getConfig() { 
  return SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("Config").getRange(2,1,4,4).getValues(); 
}

function updateSettings(slot, label, time, status) {
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("Config");
  sheet.getRange(parseInt(slot)+1, 2).setValue(label);
  sheet.getRange(parseInt(slot)+1, 3).setNumberFormat('@').setValue(time);
  sheet.getRange(parseInt(slot)+1, 4).setValue(status.toUpperCase());
  sheet.getRange(parseInt(slot)+1, 5).clearContent();
  return "OK";
}

function requestRefill(slot) { 
  SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("Commands").getRange("A1").setValue("slot"+slot+"-refill-open"); 
  return "OK";
}

function getAnalyticsData() {
  var data = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("Logs").getDataRange().getValues();
  var stats = {}; var today = new Date();
  for (var i=6; i>=0; i--) {
    var d = new Date(); d.setDate(today.getDate()-i);
    var ds = Utilities.formatDate(d, "GMT+7", "dd/MM");
    stats[ds] = { taken: 0, skipped: 0, details: [] };
  }
  if (data.length > 1) {
    for (var j=1; j<data.length; j++) {
      var rowDate = new Date(data[j][0]);
      var ds = Utilities.formatDate(rowDate, "GMT+7", "dd/MM");
      if (stats[ds]) {
        if (data[j][3] == "Pill Taken") stats[ds].taken++; 
        else if (data[j][3] == "Pill Skip") stats[ds].skipped++;
        stats[ds].details.push({slot: data[j][1], med: data[j][2], time: Utilities.formatDate(rowDate, "GMT+7", "HH:mm"), status: (data[j][3]=="Pill Taken"?"Taken":"Skip")});
      }
    }
  }
  return stats;
}
