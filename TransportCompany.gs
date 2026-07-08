function createTransportCompanyTomorrowArrivalDraft() {
  // 1. 내일 날짜(Today + 1) 계산
  var today = new Date();
  var tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  var year = tomorrow.getFullYear();
  var month = ('0' + (tomorrow.getMonth() + 1)).slice(-2);
  var day = ('0' + tomorrow.getDate()).slice(-2);
  var tomorrowMMDD = month + day; // 예: "0709"
  var dateStr = month + '/' + day; // 예: "07/09"
  var arrivalDateStr = year + '-' + month + '-' + day; // 예: "2026-07-09"

  // 2. 구글 드라이브에서 'JWTNL 스케쥴관리' 파일 찾기
  var spreadsheetName = 'JWTNL 스케쥴관리';
  var files = DriveApp.getFilesByName(spreadsheetName);
  var ss = null;

  if (files.hasNext()) {
    var spreadsheetFile = files.next();
    ss = SpreadsheetApp.open(spreadsheetFile);
  } else {
    Logger.log("에러: 구글 드라이브에서 '" + spreadsheetName + "' 파일을 찾을 수 없습니다.");
    return;
  }

  // 컬럼 번호는 0부터 시작합니다. A열=0, B열=1, C열=2, D열=3, E열=4
  var sheetConfigs = [
    {
      sheetName: '항공 알리',
      mawbCol: 0,
      flightCol: 1,
      etaCol: 2,
      qtyCol: null
    },
    {
      sheetName: '항공 타업체',
      mawbCol: 1,
      flightCol: 2,
      etaCol: 3,
      qtyCol: 4
    }
  ];

  var matchedRows = [];

  for (var i = 0; i < sheetConfigs.length; i++) {
    var sheetRows = collectTransportRowsFromSheet_(ss, sheetConfigs[i], tomorrowMMDD, arrivalDateStr);
    matchedRows = matchedRows.concat(sheetRows);
  }

  matchedRows.sort(function(a, b) {
    return compareTransportEta_(a.eta, b.eta);
  });

  // 3. 이메일 본문 HTML 표 생성
  var htmlBody = '<p>안녕하세요. JWTNL 입니다.</p>';
  htmlBody += '<p>아래 내용에 따라 운송 부탁드립니다.</p>';

  htmlBody += "<table border='1' style='border-collapse: collapse; text-align: center; width: 100%; max-width: 900px; font-family: Arial, sans-serif;'>";
  htmlBody += "<tr><th colspan='8' style='padding: 8px; background-color: #f2f2f2; font-weight: bold;'>JWTNL 입항리스트</th></tr>";
  htmlBody += "<tr style='background-color: #f2f2f2; font-weight: bold;'>";
  htmlBody += "<th style='padding: 8px;'>순번</th>";
  htmlBody += "<th style='padding: 8px;'>입항일자</th>";
  htmlBody += "<th style='padding: 8px;'>편명</th>";
  htmlBody += "<th style='padding: 8px;'>입항시간</th>";
  htmlBody += "<th style='padding: 8px;'>MWAB</th>";
  htmlBody += "<th style='padding: 8px;'>CTN</th>";
  htmlBody += "<th style='padding: 8px;'>수량</th>";
  htmlBody += "<th style='padding: 8px;'>중량</th>";
  htmlBody += '</tr>';

  if (matchedRows.length === 0) {
    htmlBody += "<tr><td colspan='8' style='padding: 8px; color: #d93025;'>내일(" + dateStr + ") 입항 예정인 MAWB 데이터가 없습니다.</td></tr>";
  } else {
    for (var j = 0; j < matchedRows.length; j++) {
      var row = matchedRows[j];
      htmlBody += '<tr>';
      htmlBody += "<td style='padding: 8px;'>" + (j + 1) + '</td>';
      htmlBody += "<td style='padding: 8px;'>" + escapeTransportHtml_(row.arrivalDate) + '</td>';
      htmlBody += "<td style='padding: 8px;'>" + escapeTransportHtml_(row.flight) + '</td>';
      htmlBody += "<td style='padding: 8px;'>" + escapeTransportHtml_(formatTransportEtaTime_(row.eta)) + '</td>';
      htmlBody += "<td style='padding: 8px;'>" + escapeTransportHtml_(row.mawb) + '</td>';
      htmlBody += "<td style='padding: 8px; background-color: #fffae6; color: #999;'>[수기 입력]</td>";
      htmlBody += "<td style='padding: 8px;'>" + escapeTransportHtml_(formatTransportNumber_(row.qty)) + '</td>';
      htmlBody += "<td style='padding: 8px; background-color: #fffae6; color: #999;'>[수기 입력]</td>";
      htmlBody += '</tr>';
    }
  }

  htmlBody += '</table>';
  htmlBody += '<p>감사합니다.</p>';

  // 4. Gmail 임시보관함 생성
  var recipient = '문주연 <ks4153@kslogi21.com>, 공성 <kikgusan@naver.com>, 공성 <kongsunglogis@daum.net>';
  var subject = '[JWTNL] ' + dateStr + ' 입항리스트 송부의 건';

  GmailApp.createDraft(recipient, subject, '', {
    htmlBody: htmlBody
  });

  Logger.log('하기운송업체 임시메일 초안 생성 완료: ' + subject);
  Logger.log('대상 MAWB 수: ' + matchedRows.length);
}

function collectTransportRowsFromSheet_(ss, config, targetMMDD, arrivalDateStr) {
  var sheet = ss.getSheetByName(config.sheetName);

  if (!sheet) {
    Logger.log("주의: '" + config.sheetName + "' 시트를 찾을 수 없어 건너뜁니다.");
    return [];
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log("주의: '" + config.sheetName + "' 시트에 가져올 데이터가 없습니다.");
    return [];
  }

  var rowsToRead = 1000;
  var startRow = lastRow - rowsToRead + 1;

  if (startRow < 2) {
    startRow = 2;
    rowsToRead = lastRow - 1;
  }

  var maxCol = Math.max(config.mawbCol, config.flightCol, config.etaCol, config.qtyCol == null ? 0 : config.qtyCol) + 1;
  var data = sheet.getRange(startRow, 1, rowsToRead, maxCol).getValues();
  var rows = [];

  for (var i = 0; i < data.length; i++) {
    var eta = String(data[i][config.etaCol] || '').trim();

    if (eta.substring(0, 4) !== targetMMDD) {
      continue;
    }

    var mawb = normalizeTransportMawb_(data[i][config.mawbCol]);
    if (!mawb) {
      continue;
    }

    rows.push({
      sourceSheet: config.sheetName,
      arrivalDate: arrivalDateStr,
      flight: data[i][config.flightCol],
      eta: eta,
      mawb: mawb,
      qty: config.qtyCol == null ? '[수기 입력]' : data[i][config.qtyCol]
    });
  }

  return rows;
}

function compareTransportEta_(left, right) {
  var leftKey = String(left || '');
  var rightKey = String(right || '');
  return leftKey.localeCompare(rightKey);
}

function formatTransportEtaTime_(eta) {
  var text = String(eta || '').trim();
  var digits = text.replace(/\D/g, '');

  if (digits.length >= 8) {
    return Number(digits.substring(4, 6)) + ':' + digits.substring(6, 8);
  }

  if (digits.length >= 6) {
    return Number(digits.substring(4, 6)) + ':00';
  }

  return text;
}

function formatTransportNumber_(value) {
  if (value === '' || value == null) {
    return '[수기 입력]';
  }

  if (typeof value === 'number') {
    return value.toLocaleString('ko-KR');
  }

  return String(value).trim() || '[수기 입력]';
}

function normalizeTransportMawb_(value) {
  return String(value || '').trim();
}

function escapeTransportHtml_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
