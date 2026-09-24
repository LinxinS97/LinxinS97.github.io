// Retry model generation only, never an agent turn, quota reservation or email send.
export class ModelRequestError extends Error {
  constructor(status, message, retryable = false) {
    super(message); this.status = status; this.retryable = retryable;
  }
}
export function invalidModelOutput(message = 'The agent returned an invalid action. Please try again.') {
  throw new ModelRequestError(502, message, true);
}
const transient = status => [408, 429, 500, 502, 503, 504, 520, 522, 524].includes(status);

export async function modelRequest(env, body, fetcher, {
  validate = value => value, timeoutMs = 60000, attempts = 3,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), onAttempt = () => {}
} = {}) {
  // A single shared attempt budget covers HTTP, JSON and action-format failures.
  const limit = Math.min(3, Math.max(1, attempts));
  for (let attempt = 0; attempt < limit; attempt++) {
    try {
      onAttempt(attempt);
      let response;
      try {
        response = await fetcher(env.OPENROUTER_BASE_URL.replace(/\/+$/, '') + '/chat/completions', {
          method: 'POST', signal: AbortSignal.timeout(timeoutMs),
          headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
      } catch (error) {
        if (!(error instanceof TypeError) && !['TimeoutError', 'AbortError'].includes(error?.name)) throw error;
        throw new ModelRequestError(502, 'The model connection timed out or failed. Please try again.', true);
      }
      if (!response.ok) {
        // Never include provider bodies or headers in errors or retry instructions.
        if (response.status === 401 || response.status === 403) throw new ModelRequestError(502, 'The model connection could not authenticate.');
        if (response.status === 402) throw new ModelRequestError(502, 'The model account has insufficient credit.');
        const error = new ModelRequestError(response.status === 429 ? 429 : 502,
          response.status === 429 ? 'The model is busy. Please try again shortly.' : 'The model is temporarily unavailable.', transient(response.status));
        const retryAfter = response.headers.get('Retry-After');
        if (retryAfter) {
          const seconds = Number(retryAfter);
          error.delay = Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : Math.max(0, Date.parse(retryAfter) - Date.now());
        }
        await response.body?.cancel();
        throw error;
      }
      let data;
      try { data = await response.json(); }
      catch (error) {
        if (!(error instanceof SyntaxError) && !(error instanceof TypeError) && !['TimeoutError', 'AbortError'].includes(error?.name)) throw error;
        invalidModelOutput('The model returned an incomplete response. Please try again.');
      }
      return validate(data);
    } catch (error) {
      if (!(error instanceof ModelRequestError) || !error.retryable || attempt + 1 === limit) throw error;
      // Long provider cooldowns belong in a later visitor request, not an open HTTP call.
      if (error.delay > 5000) throw error;
      await sleep(Math.max(300 * 2 ** attempt, error.delay || 0));
    }
  }
}
