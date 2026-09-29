import { createHmac } from "node:crypto";
import { ConnectorError, type ConnectionStatus } from "@autofarm/connectors";

export type HealthOutcome = { status: ConnectionStatus; message: string | null };
type Secrets = Record<string, string>;

async function call(fetchFn: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    throw new ConnectorError("네트워크 오류", "network", e);
  }
  if (res.status === 401 || res.status === 403) throw new ConnectorError(`인증 실패(${res.status})`, "auth_expired");
  if (res.status === 429) throw new ConnectorError("요청 한도 초과(429)", "rate_limited");
  if (!res.ok) throw new ConnectorError(`응답 오류(${res.status})`, "bad_response");
  return res;
}

/** 네이버 검색광고 keywordstool — X-Signature = base64(HMAC-SHA256(secret, "{ts}.GET./keywordstool")) */
export async function checkNaverSearchad(s: Secrets, fetchFn: typeof fetch = fetch, now = Date.now()): Promise<HealthOutcome> {
  const ts = String(now);
  const sig = createHmac("sha256", s.secret_key ?? "").update(`${ts}.GET./keywordstool`).digest("base64");
  const res = await call(fetchFn, "https://api.searchad.naver.com/keywordstool?hintKeywords=%EC%82%AC%EA%B3%BC&showDetail=1", {
    headers: { "X-Timestamp": ts, "X-API-KEY": s.access_license ?? "", "X-Customer": s.customer_id ?? "", "X-Signature": sig },
  });
  const body = (await res.json()) as { keywordList?: unknown[] };
  if (!Array.isArray(body.keywordList)) throw new ConnectorError("응답 형식이 다릅니다", "bad_response");
  return { status: "ok", message: `연관 키워드 ${body.keywordList.length}개 응답` };
}

/** 데이터랩(NAVER Cloud API HUB) 검색어트렌드 */
export async function checkNaverDatalab(s: Secrets, fetchFn: typeof fetch = fetch, today = new Date()): Promise<HealthOutcome> {
  const end = today.toISOString().slice(0, 10);
  const start = new Date(today.getTime() - 30 * 86400_000).toISOString().slice(0, 10);
  const res = await call(fetchFn, "https://naverapihub.apigw.ntruss.com/search-trend/v1/search", {
    method: "POST",
    headers: { "X-NCP-APIGW-API-KEY-ID": s.client_id ?? "", "X-NCP-APIGW-API-KEY": s.client_secret ?? "", "Content-Type": "application/json" },
    body: JSON.stringify({ startDate: start, endDate: end, timeUnit: "week", keywordGroups: [{ groupName: "사과", keywords: ["사과"] }] }),
  });
  const body = (await res.json()) as { results?: unknown[] };
  if (!Array.isArray(body.results)) throw new ConnectorError("응답 형식이 다릅니다", "bad_response");
  return { status: "ok", message: "검색어트렌드 응답 정상" };
}

export const HEALTH_CHECKS: Record<string, (s: Secrets, f?: typeof fetch) => Promise<HealthOutcome>> = {
  "data:naver-searchad": checkNaverSearchad,
  "data:naver-datalab": checkNaverDatalab,
};
