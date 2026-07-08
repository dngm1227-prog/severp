function createOtherCompanyTomorrowReportDraft() {
  // 1. 내일 날짜(Today + 1) 계산
  var today = new Date();
  var tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  var month = ('0' + (tomorrow.getMonth() + 1)).slice(-2);
  var day = ('0' + tomorrow.getDate()).slice(-2);
  var tomorrowMMDD = month + day; // 예: "0707"
  var dateStr = month + '/' + day; // 예: "07/07"

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

  // '항공 타업체' 시트 가져오기
  var sheet = ss.getSheetByName('항공 타업체');
  if (!sheet) {
    Logger.log("에러: '" + spreadsheetName + "' 파일 내에 '항공 타업체' 시트를 찾을 수 없습니다.");
    return;
  }

  // 3. 스프레드시트 데이터 수집 및 필터링 (최근 500행 제한)
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('가져올 데이터가 없습니다.');
    return;
  }

  var rowsToRead = 1000;
  var startRow = lastRow - rowsToRead + 1;

  if (startRow < 2) {
    startRow = 2;
    rowsToRead = lastRow - 1;
  }

  // A열: 정산처, B열: MAWB, C열: 편명, D열: 입항시간
  var data = sheet.getRange(startRow, 1, rowsToRead, 4).getValues();
  var matchedRows = [];

  for (var i = 0; i < data.length; i++) {
    var customer = String(data[i][0] || '').trim();
    var mawb = normalizeMawb(data[i][1]);
    var flight = data[i][2];
    var etaTime = String(data[i][3]).trim();

    if (etaTime.substring(0, 4) === tomorrowMMDD) {
      matchedRows.push({
        customer: customer,
        mawb: mawb,
        flight: flight,
        eta: etaTime
      });
    }
  }

  // 4. MAWB/정산처 기준으로 타업체용 일반신고 데이터 파일 찾기 및 첨부
  var attachmentResult = collectOtherCompanyAttachments_(matchedRows, tomorrowMMDD);

  // 5. 이메일 본문 HTML 표 생성
  var htmlBody = '<p>안녕하세요 JWTNL 입니다.</p>';
  htmlBody += '<p>' + dateStr + ' 입항 일반수입신고 전송건수 안내 관련 메일입니다.</p>';

  if (matchedRows.length === 0) {
    htmlBody += "<p style='color:red;'>내일(" + dateStr + ") 입항 예정인 타업체 스케쥴 데이터가 시트에 없습니다.</p>";
  } else {
    htmlBody += "<table border='1' style='border-collapse: collapse; text-align: center; width: 100%; max-width: 850px; font-family: Arial, sans-serif;'>";
    htmlBody += "<tr style='background-color: #f2f2f2; font-weight: bold;'>";
    htmlBody += "<th style='padding: 8px;'>정산처</th>";
    htmlBody += "<th style='padding: 8px;'>MAWB</th>";
    htmlBody += "<th style='padding: 8px;'>편명</th>";
    htmlBody += "<th style='padding: 8px;'>입항 시간</th>";
    htmlBody += "<th style='padding: 8px;'>일반의뢰건수</th>";
    htmlBody += "<th style='padding: 8px;'>첨부파일</th>";
    htmlBody += '</tr>';

    for (var j = 0; j < matchedRows.length; j++) {
      var row = matchedRows[j];
      var rowKey = buildOtherCompanyRowKey_(row);
      var attachmentStatus = attachmentResult.foundMap[rowKey] ? '첨부 완료' : '첨부 필요';
      var attachmentStyle = attachmentResult.foundMap[rowKey]
        ? "padding: 8px; color: #188038;"
        : "padding: 8px; background-color: #ffecec; color: #d93025; font-weight: bold;";

      htmlBody += '<tr>';
      htmlBody += "<td style='padding: 8px;'>" + escapeHtml_(row.customer) + '</td>';
      htmlBody += "<td style='padding: 8px;'>" + escapeHtml_(row.mawb) + '</td>';
      htmlBody += "<td style='padding: 8px;'>" + escapeHtml_(row.flight) + '</td>';
      htmlBody += "<td style='padding: 8px;'>" + escapeHtml_(row.eta) + '</td>';
      htmlBody += "<td style='padding: 8px; background-color: #fffae6; color: #999;'>[수기 입력]</td>";
      htmlBody += "<td style='" + attachmentStyle + "'>" + attachmentStatus + '</td>';
      htmlBody += '</tr>';
    }

    htmlBody += '</table>';
  }

  if (attachmentResult.missingFileNames.length > 0) {
    htmlBody += "<div style='margin-top: 16px; padding: 12px; border: 1px solid #d93025; background-color: #fff4f4; color: #d93025; font-family: Arial, sans-serif;'>";
    htmlBody += "<p style='margin: 0 0 8px 0; font-weight: bold;'>아래 첨부파일을 구글 드라이브에서 찾지 못했습니다. 발송 전 수기로 첨부해 주세요.</p>";
    htmlBody += '<ul style="margin: 0; padding-left: 20px;">';
    for (var k = 0; k < attachmentResult.missingFileNames.length; k++) {
      htmlBody += '<li>' + escapeHtml_(attachmentResult.missingFileNames[k]) + '</li>';
    }
    htmlBody += '</ul>';
    htmlBody += '</div>';
  }

  htmlBody += '<br><p>내용 및 첨부파일을 확인하신 후 발송해 주세요.</p>';

  // 6. Gmail 임시보관함 생성
  var recipient = 'lgl@jwccs.co.kr';
  var subject = '[JWTNL] ' + dateStr + ' 입항 일반수입신고 전송건수 안내';

  var options = {
    htmlBody: htmlBody
  };

  if (attachmentResult.attachments.length > 0) {
    options.attachments = attachmentResult.attachments;
  }

  GmailApp.createDraft(recipient, subject, '', options);
  Logger.log('타업체 임시메일 초안 생성 완료: ' + subject);
  Logger.log('첨부 완료 파일 수: ' + attachmentResult.attachments.length);
  Logger.log('첨부 누락 파일 수: ' + attachmentResult.missingFileNames.length);
}

function collectOtherCompanyAttachments_(matchedRows, dateMMDD) {
  var attachments = [];
  var foundMap = {};
  var missingFileNames = [];
  var checkedMap = {};

  for (var i = 0; i < matchedRows.length; i++) {
    var row = matchedRows[i];
    var rowKey = buildOtherCompanyRowKey_(row);

    if (!row.mawb || !row.customer || checkedMap[rowKey]) {
      continue;
    }

    checkedMap[rowKey] = true;

    var expectedFileName = buildExpectedOtherCompanyAttachmentPattern_(dateMMDD, row);
    var file = findOtherCompanyAttachmentFile_(dateMMDD, row);

    if (file) {
      var blob = file.getBlob().setName(file.getName());
      attachments.push(blob);
      foundMap[rowKey] = true;
      Logger.log('첨부파일 로드 완료: ' + file.getName());
    } else {
      foundMap[rowKey] = false;
      missingFileNames.push(expectedFileName);
      Logger.log('드라이브에서 파일을 찾을 수 없습니다: ' + expectedFileName);
    }
  }

  return {
    attachments: attachments,
    foundMap: foundMap,
    missingFileNames: missingFileNames
  };
}

function findOtherCompanyAttachmentFile_(dateMMDD, row) {
  var escapedDate = escapeRegExp_(dateMMDD);
  var escapedMawb = escapeRegExp_(row.mawb);
  var escapedCustomer = escapeRegExp_(row.customer);
  var fileNamePattern = new RegExp('^' + escapedDate + '입항 일반신고데이터_' + escapedMawb + '_\\d+건\\(' + escapedCustomer + '\\)\\.xlsx$', 'i');
  var query = "title contains '" + escapeDriveSearchValue_(row.mawb) + "' and title contains '" + escapeDriveSearchValue_(dateMMDD) + "' and title contains '.xlsx' and trashed = false";
  var driveFile = findOtherCompanyDriveFileIncludingSharedDrives_(query, function(fileName) {
    return fileNamePattern.test(fileName);
  });

  if (driveFile) {
    return driveFile;
  }

  var files = DriveApp.searchFiles(query);

  while (files.hasNext()) {
    var file = files.next();
    var fileName = file.getName();

    if (fileNamePattern.test(fileName)) {
      return file;
    }
  }

  return null;
}

function findOtherCompanyDriveFileIncludingSharedDrives_(query, fileNameMatcher) {
  if (typeof Drive === 'undefined' || !Drive.Files || !Drive.Files.list) {
    Logger.log('고급 Drive 서비스가 꺼져 있어 DriveApp 검색으로 대체합니다.');
    return null;
  }

  var pageToken = null;

  do {
    var response = Drive.Files.list({
      q: query,
      maxResults: 100,
      pageToken: pageToken,
      corpora: 'allDrives',
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      fields: 'items(id,title),nextPageToken'
    });

    var items = response.items || [];

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var fileName = item.title || '';

      if (fileNameMatcher(fileName)) {
        return DriveApp.getFileById(item.id);
      }
    }

    pageToken = response.nextPageToken;
  } while (pageToken);

  return null;
}

function buildExpectedOtherCompanyAttachmentPattern_(dateMMDD, row) {
  return dateMMDD + '입항 일반신고데이터_' + row.mawb + '_n건(' + row.customer + ').xlsx';
}

function buildOtherCompanyRowKey_(row) {
  return row.mawb + '|' + row.customer;
}
