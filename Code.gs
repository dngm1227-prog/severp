function createAdvancedTomorrowReportDraft() {
  // 1. 내일 날짜(Today + 1) MMDD 형식 계산
  var today = new Date();
  var tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  var month = ('0' + (tomorrow.getMonth() + 1)).slice(-2);
  var day = ('0' + tomorrow.getDate()).slice(-2);
  var tomorrowMMDD = month + day; // 예: "0704"
  var dateStr = month + '/' + day; // 예: "07/04"

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

  // '항공 알리' 시트 가져오기
  var sheet = ss.getSheetByName('항공 알리');
  if (!sheet) {
    Logger.log("에러: '" + spreadsheetName + "' 파일 내에 '항공 알리' 시트를 찾을 수 없습니다.");
    return;
  }

  // 3. 스프레드시트 데이터 수집 및 필터링 (최근 500행 제한)
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('가져올 데이터가 없습니다.');
    return;
  }

  var rowsToRead = 500;
  var startRow = lastRow - rowsToRead + 1;

  if (startRow < 2) {
    startRow = 2;
    rowsToRead = lastRow - 1;
  }

  // A열부터 S열(19개 열)까지 최근 500개 행만 가져오기
  var data = sheet.getRange(startRow, 1, rowsToRead, 19).getValues();
  var matchedRows = [];

  // 조건 확인: C열(입항 시간)의 앞 4자리가 내일 날짜(MMDD)와 일치하는지 확인
  for (var i = 0; i < data.length; i++) {
    var mawb = normalizeMawb(data[i][0]); // A열 (MAWB)
    var flight = data[i][1]; // B열 (항공편명주)
    var etaTime = String(data[i][2]).trim(); // C열 (입항 시간)

    if (etaTime.substring(0, 4) === tomorrowMMDD) {
      matchedRows.push({
        mawb: mawb,
        flight: flight,
        eta: etaTime
      });
    }
  }

  // 4. 3번에서 가져온 MAWB 기준으로 'MAWB.xlsx' 파일 찾기 및 첨부 설정
  var attachmentResult = collectMasterDeclarationAttachment_(matchedRows, tomorrowMMDD);

  // 5. 이메일 본문 HTML 표(Table) 생성
  var htmlBody = '<p>안녕하세요 JWTNL 입니다.</p>';
  htmlBody += '<p>' + dateStr + ' 입항 일반신고 전송건수 안내 관련 메일입니다.</p>';

  if (matchedRows.length === 0) {
    htmlBody += "<p style='color:red;'>내일(" + dateStr + ') 입항 예정인 스케쥴 데이터가 시트에 없습니다.</p>';
  } else {
    htmlBody += "<table border='1' style='border-collapse: collapse; text-align: center; width: 100%; max-width: 700px; font-family: Arial, sans-serif;'>";
    htmlBody += "<tr style='background-color: #f2f2f2; font-weight: bold;'>";
    htmlBody += "<th style='padding: 8px;'>MAWB</th>";
    htmlBody += "<th style='padding: 8px;'>항공편명주</th>";
    htmlBody += "<th style='padding: 8px;'>입항 시간</th>";
    htmlBody += "<th style='padding: 8px;'>일반의뢰건수</th>";
    htmlBody += '</tr>';

    for (var j = 0; j < matchedRows.length; j++) {
      var row = matchedRows[j];
      var attachmentStatus = attachmentResult.foundMap[row.mawb] ? '첨부 완료' : '첨부 필요';
      var attachmentStyle = attachmentResult.foundMap[row.mawb]
        ? "padding: 8px; color: #188038;"
        : "padding: 8px; background-color: #ffecec; color: #d93025; font-weight: bold;";

      htmlBody += '<tr>';
      htmlBody += "<td style='padding: 8px;'>" + escapeHtml_(row.mawb) + '</td>';
      htmlBody += "<td style='padding: 8px;'>" + escapeHtml_(row.flight) + '</td>';
      htmlBody += "<td style='padding: 8px;'>" + escapeHtml_(row.eta) + '</td>';
      htmlBody += "<td style='padding: 8px; background-color: #fffae6; color: #999;'>[수기 입력]</td>";
      htmlBody += '</tr>';
    }
    htmlBody += '</table>';
  }

  // 6. Gmail 임시보관함 생성 (HTML 적용)
  var recipient = 'bs@jwccs.co.kr';
  var subject = '[JWTNL]' + dateStr + ' 입항 일반신고 전송건수 안내 (인천공항)';

  var options = {
    htmlBody: htmlBody
  };

  if (attachmentResult.attachments.length > 0) {
    options.attachments = attachmentResult.attachments;
  }

  GmailApp.createDraft(recipient, subject, '', options);
  Logger.log('임시메일 초안 생성 완료: ' + subject);
  Logger.log('첨부 완료 파일 수: ' + attachmentResult.attachments.length);
  Logger.log('첨부 누락 파일 수: ' + attachmentResult.missingFileNames.length);
}

function collectMasterDeclarationAttachment_(matchedRows, dateMMDD) {
  var attachments = [];
  var foundMap = {};
  var missingFileNames = [];
  var expectedFileName = buildExpectedMasterDeclarationAttachmentPattern_(dateMMDD);
  var files = findMasterDeclarationAttachmentFiles_(dateMMDD);

  if (files.length > 0) {
    for (var fileIndex = 0; fileIndex < files.length; fileIndex++) {
      var file = files[fileIndex];
      var blob = file.getBlob().setName(file.getName());
      attachments.push(blob);
      Logger.log('첨부파일 로드 완료: ' + file.getName());
    }
  } else {
    missingFileNames.push(expectedFileName);
    Logger.log('드라이브에서 파일을 찾을 수 없습니다: ' + expectedFileName);
  }

  for (var i = 0; i < matchedRows.length; i++) {
    var mawb = matchedRows[i].mawb;
    foundMap[mawb] = files.length > 0;
  }

  return {
    attachments: attachments,
    foundMap: foundMap,
    missingFileNames: missingFileNames
  };
}

function findMasterDeclarationAttachmentFiles_(dateMMDD) {
  var query = "title contains '" + escapeDriveSearchValue_(dateMMDD) + "' and title contains '일반신고' and title contains '.xlsx' and trashed = false";
  var files = DriveApp.searchFiles(query);
  var matchedFiles = [];
  var seenFileIds = {};

  while (files.hasNext()) {
    var file = files.next();
    var fileName = file.getName();

    if (isAliDeclarationAttachmentFile_(fileName, dateMMDD) && !seenFileIds[file.getId()]) {
      seenFileIds[file.getId()] = true;
      matchedFiles.push(file);
    }
  }

  matchedFiles.sort(function(a, b) {
    return a.getName().localeCompare(b.getName());
  });

  return matchedFiles;
}

function findMasterDeclarationAttachmentFile_(dateMMDD) {
  var files = findMasterDeclarationAttachmentFiles_(dateMMDD);

  if (files.length > 0) {
    return files[0];
  }

  return null;
}

function isAliDeclarationAttachmentFile_(fileName, dateMMDD) {
  var lowerFileName = String(fileName || '').toLowerCase();

  return (
    fileName.indexOf(dateMMDD) !== -1 &&
    fileName.indexOf('알리(항공)') !== -1 &&
    fileName.indexOf('일반신고') !== -1 &&
    fileName.indexOf('인천공항') !== -1 &&
    lowerFileName.slice(-5) === '.xlsx'
  );
}

function buildExpectedMasterDeclarationAttachmentPattern_(dateMMDD) {
  return dateMMDD + '입항 알리(항공) 일반신고_MAWB - n건(인천공항).xlsx';
}

function normalizeMawb(value) {
  return String(value || '').trim();
}

function escapeRegExp_(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeDriveSearchValue_(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function escapeHtml_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
