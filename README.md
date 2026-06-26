# 특송 전자상거래 통관 API 송수신 서버

고객사 주문 수신, 관세청 주문/개인통관부호 송신, 구매자 일회용 인증번호 수집, 내부 운영 시스템 API 전송을 처리하는 MVP 서버입니다.

## 실행

```powershell
$env:CLIENT_API_KEYS="dev-client-key"
$env:ADMIN_API_KEYS="dev-admin-key"
node src/server.js
```

Codex 번들 Node를 사용할 때:

```powershell
C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe src/server.js
```

기본 주소는 `http://localhost:3000` 입니다.

## 주요 API

- `POST /api/client/orders`: 고객사 주문 데이터 수신, `x-api-key: dev-client-key`
- `GET /api/client/orders/{orderId}/status`: 주문 처리 상태 조회, `x-api-key: dev-client-key`
- `POST /api/customs/orders`: 관세청 송신, `x-api-key: dev-admin-key`
- `POST /api/messages/verification-request`: 구매자 인증번호 입력 요청 발송, `x-api-key: dev-admin-key`
- `GET /buyer/verification/{orderId}`: 구매자 인증번호 입력 페이지
- `POST /api/buyer/verification-code`: 구매자 인증번호 수신
- `POST /api/internal/orders`: 내부 운영 시스템 전송, `x-api-key: dev-admin-key`
- `GET /api/admin/orders`: 관리자 주문 목록, `x-api-key: dev-admin-key`
- `POST /api/admin/retry/{orderId}`: 현재 상태에 맞는 재시도, `x-api-key: dev-admin-key`

## 외부 연동 설정

외부 URL이 없으면 성공 응답을 시뮬레이션합니다.

- `CUSTOMS_API_URL`: 관세청 API 수신 URL
- `MESSAGE_API_URL`: 카카오톡/SMS 발송 API URL
- `INTERNAL_API_URL`: 내부 운영 시스템 API URL
- `PUBLIC_BASE_URL`: 구매자 인증번호 입력 링크의 공개 base URL
- `DATABASE_FILE`: JSON 저장소 파일 경로
- `VERIFICATION_TTL_MINUTES`: 인증번호 입력 요청 만료 시간

## 예시 주문

```json
{
  "orderId": "ORDER-1001",
  "clientId": "CLIENT-A",
  "buyer": {
    "name": "홍길동",
    "email": "buyer@example.com",
    "phone": "010-1234-5678",
    "personalCustomsCode": "P123456789012"
  },
  "shipping": {
    "address": "서울시 중구 세종대로 1",
    "postalCode": "04524"
  },
  "items": [
    {
      "name": "Wireless Mouse",
      "quantity": 1,
      "amount": 25000,
      "currency": "KRW"
    }
  ]
}
```

## 테스트

```powershell
node --test
```
