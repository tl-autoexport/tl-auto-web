const ENCAR_IP_CHECK_URL =
  "https://api.encar.com/international/communication/validate-request-ip";
const ENCAR_VERIFY_URL = "https://api.encar.com/pass/user/verify";

export const ENCAR_HEADERS = {
  "User-Agent":
    process.env.ENCAR_USER_AGENT?.trim() ||
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
  Referer: "https://car.encar.com/",
  Origin: "https://car.encar.com",
};

type IpCheckResponse = { ipAddress?: string; ip?: string };
type VerifyResponse = { status?: string };

function responsePreview(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 180);
}

/**
 * Server-side Encar client. The verification is deliberately tied to the
 * server's egress IP; forwarded client headers must never be sent to Encar.
 */
export class EncarClient {
  private verification: Promise<void> | null = null;

  private async verify() {
    let ip = process.env.ENCAR_PUBLIC_IP?.trim();
    if (!ip) {
      const ipResponse = await fetch(ENCAR_IP_CHECK_URL, {
        headers: ENCAR_HEADERS,
        signal: AbortSignal.timeout(10_000),
      });
      if (!ipResponse.ok) {
        throw new Error(`Encar IP check HTTP ${ipResponse.status}`);
      }

      const ipPayload = (await ipResponse.json()) as IpCheckResponse;
      ip = ipPayload.ipAddress?.trim() || ipPayload.ip?.trim();
    }
    if (!ip) {
      throw new Error(
        "Encar verification requires a server egress IP; set ENCAR_PUBLIC_IP when the IP check response has no ipAddress field",
      );
    }

    const response = await fetch(ENCAR_VERIFY_URL, {
      method: "POST",
      headers: { ...ENCAR_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({
        userIdentifier: {
          ipAddress: ip,
          userAgent: ENCAR_HEADERS["User-Agent"],
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `Encar verification HTTP ${response.status}: ${responsePreview(text)}`,
      );
    }

    let payload: VerifyResponse;
    try {
      payload = JSON.parse(text) as VerifyResponse;
    } catch {
      throw new Error("Encar verification returned invalid JSON");
    }
    if (payload.status !== "VERIFIED") {
      throw new Error(`Encar verification was not accepted: ${payload.status ?? "unknown status"}`);
    }
  }

  private async ensureVerified() {
    if (!this.verification) {
      this.verification = this.verify().catch((error) => {
        this.verification = null;
        throw error;
      });
    }
    await this.verification;
  }

  async response(url: string, init: RequestInit = {}, attempts = 3): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await this.ensureVerified();
        const response = await fetch(url, {
          ...init,
          headers: { ...ENCAR_HEADERS, ...(init.headers ?? {}) },
          signal: init.signal ?? AbortSignal.timeout(15_000),
        });

        if (response.status === 401 || response.status === 407) {
          this.verification = null;
          if (attempt < attempts) {
            await response.arrayBuffer();
            continue;
          }
        }
        return response;
      } catch (error) {
        lastError = error;
        if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
      }
    }
    throw lastError;
  }

  async request<T>(url: string, init: RequestInit = {}, attempts = 3): Promise<T> {
    const response = await this.response(url, init, attempts);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Encar HTTP ${response.status}: ${responsePreview(text)}`);
    }
    return (await response.json()) as T;
  }
}

export const encarClient = new EncarClient();
