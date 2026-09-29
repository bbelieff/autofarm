# AI 프로바이더 — 구독·API 접근 확인표

> 확인일 2026-09-29. 모델 목록은 자주 바뀌므로 **앱은 이 표를 하드코딩하지 않고** 실행 시 목록을 불러옵니다(아래 「목록 갱신」). 이 문서는 설계 시점의 스냅샷입니다.

## 1. 요약

| 프로바이더 | 구독으로 쓰기 | API로 쓰기 | 앱에서 호출하는 방법 |
|---|---|---|---|
| Claude | **가능(조건부)** — 유료 구독의 월 「Agent SDK 크레딧」 안에서, 계정 주인 본인 사용 | 가능 | 구독: 서버에서 `claude -p` 헤드리스 실행 / API: Anthropic API 키 |
| Codex (OpenAI) | **가능** — ChatGPT 로그인한 Codex CLI | 가능 | 구독: `codex exec` / API: OpenAI API 키 |
| Muse Spark (Meta) | **가능** — Muse Code CLI 브라우저 로그인 | 가능(종량제) | 구독: `muse exec` / API: Meta Model API 키 |
| Gemini (Google) | **불가** — 2026-06-18에 Gemini CLI 개인 Google 로그인(AI Pro·Ultra 포함) 종료, Antigravity CLI로 이전 | 가능 | API 키만(AI Studio 또는 Vertex AI) |

## 2. 구독 경로에서 고를 수 있는 모델·노력

### Claude — Claude Code CLI 2.1.281 (`--model`, `--effort`)

| 별칭 | 모델 | API 모델 ID |
|---|---|---|
| `fable` | Claude Fable 5.1 | `claude-fable-5-1` |
| `opus` | Claude Opus 5.5 | `claude-opus-5-5` |
| `sonnet` | Claude Sonnet 5.5 | `claude-sonnet-5-5` |
| `haiku` | Claude Haiku 4.5 | `claude-haiku-4-5-20251001` |

- 노력: `low · medium · high · xhigh · max` (모델이 지원하는 범위 안에서 적용)
- 조건: 2026-06-15부터 프로그램 방식 사용(`claude -p`·Agent SDK)은 구독 기본 한도가 아니라 **월 Agent SDK 크레딧**(Pro $20 · Max 5x $100 · Max 20x $200, API 요율로 차감, 이월 없음)에서 나갑니다. 다 쓰면 추가 사용 결제가 필요합니다.
- 다른 사람에게 제공하는 제품에는 API 키 인증을 쓰라는 것이 Anthropic의 개발자 안내입니다 → 구독 모드는 **계정 주인 본인 워크스페이스에만** 허용합니다.

### Codex — codex-cli 0.153.4 모델 캐시(2026-09-29)

| 모델 | 노력 | 기본 노력 |
|---|---|---|
| `gpt-6-astra` | low · medium · high · xhigh · max · ultra | medium |
| `gpt-6-sol` | low · medium · high · xhigh · max · ultra | medium |
| `gpt-6-luna` | low · medium · high · xhigh · max | medium |
| `gpt-5.6-sol` | low · medium · high · xhigh · max · ultra | low |
| `gpt-5.6-terra` | low · medium · high · xhigh · max · ultra | medium |
| `gpt-5.6-luna` | low · medium · high · xhigh · max | medium |
| `gpt-5.5` | low · medium · high · xhigh | medium |

- 숨김 모델(`gpt-reserve`, `codex-auto-review`)은 목록에서 뺍니다.

### Muse Spark — Muse Code CLI (`--model`, `--reasoning-effort`)

| 모델 | 비고 |
|---|---|
| `muse-spark-1.3` | |
| `muse-spark-1.3-contributor` | 이 PC에서 실제 호출 성공 확인(2026-09-29) |
| `muse-spark-1.2` | CLI 기본 모델로 알려짐 |
| `muse-spark-1.2-contributor` | |
| `muse-spark-1.1` | |

- 노력: `none · minimal · low · medium · high · xhigh · max · ultra` (CLI 도움말 기준, 기본 high)
- ⚠ 모델 ID 목록은 공식 문서 표가 아니라 제3자 정리에서 확인했습니다. 실제 호출 성공은 `muse-spark-1.3-contributor` 하나뿐입니다. 실행 메타데이터의 「적용된 노력」 값이 비어 있어(null) 노력이 실제로 적용되는지는 확인되지 않았습니다.
- 구독 요금제: Everyday(5시간마다 10~50 프롬프트) · High(5배) · Power(20배). 공식 문서는 구독이 「Muse Code CLI에서 로그인한 상태로만」 동작한다고 적고 있습니다 → 서버에서 CLI를 실행하는 방식만 씁니다.
- contributor 모델은 입력·응답이 Meta 모델 학습에 쓰일 수 있습니다 → 비밀값·구매자 개인정보는 보내지 않습니다(§7 로거 가림과 같은 규칙).

### Gemini — API만

- 무료 API 키: Flash 모델만, 하루 250회. 유료(종량제)·Vertex AI는 제한 완화.
- 모델 목록은 API의 models 엔드포인트에서 불러옵니다.

## 3. 앱 설계 규칙

1. **프로바이더 × 인증 방식**을 워크스페이스마다 설정합니다: `claude | codex | muse | gemini` × `subscription | api`. Gemini는 `api`만 선택 가능.
2. **지금은 관리자만** 설정 화면을 엽니다. 기본값은 모든 워크스페이스 = **Muse Spark API**. 관리자 본인 워크스페이스 = **Claude 구독**.
3. 구독 모드 = 서버에 공식 CLI를 설치하고 계정 주인이 한 번 로그인 → 앱이 헤드리스로 호출(파일 쓰기·셸·웹 도구 끔, 텍스트 입출력만). **다른 워크스페이스와 공유하지 않습니다**(각 사의 약관).
4. 용도별 모델 지정: `text.fast`(키워드 판별 등) · `text.quality`(카피) · `image`(생성·편집 — 이미지 지원 여부는 P2에서 프로바이더별 확인).
5. **목록 갱신**: API 프로바이더는 models 엔드포인트, 구독 CLI는 CLI 모델 캐시·도움말에서 매일 갱신합니다. 관리자가 모델을 숨기거나 기본값을 지정합니다.
6. 사용량: `ai_usage`에 워크스페이스·프로바이더·인증 방식·모델·노력·토큰(제공 시)·시간을 저장합니다. 구독 CLI가 토큰을 주지 않으면 「측정 불가」로 저장하고 추정하지 않습니다.
7. 나중(P5): 요금제용 **「오토농장 AI」** = 운영자가 관리하는 프로바이더(내부는 Muse Spark). 사용자는 키 없이 쓰고 한도만 봅니다.

## 4. 출처

- Gemini CLI 쿼터·인증: https://geminicli.com/docs/resources/quota-and-pricing/ · https://github.com/google-gemini/gemini-cli/discussions/22970
- Claude 구독 프로그램 사용: https://venturebeat.com/technology/anthropic-reinstates-openclaw-and-third-party-agent-usage-on-claude-subscriptions-with-a-catch · https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/
- Codex ChatGPT 요금제: https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan
- Muse Code 구독: https://dev.meta.ai/docs/muse-code/subscriptions · 모델 목록(제3자): https://www.orcarouter.ai/blog/muse-code
- 로컬 확인: `claude --help`(2.1.281) · `~/.codex/models_cache.json`(0.153.4) · `muse --help` · `~/.gemini/settings.json`(API 키 방식)
