import Router from "@koa/router";

// persona-login design.md D10: resolves the login_hint OIDC parameter to a
// known seeded account id, or undefined when absent/unrecognized. Extracted
// as a pure function so the fallback-branch decision (tasks.md 3.5) is
// testable without standing up the full oidc-provider Koa app.
export function resolveKnownAccountId(loginHint, accounts) {
  if (!loginHint) return undefined;
  return Object.prototype.hasOwnProperty.call(accounts, loginHint)
    ? loginHint
    : undefined;
}

async function readUrlencodedBody(ctx) {
  const chunks = [];
  for await (const chunk of ctx.req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return Object.fromEntries(new URLSearchParams(raw));
}

function renderLoginForm({ uid, params }) {
  return `<!doctype html>
<html><body style="font-family: sans-serif; max-width: 480px; margin: 3rem auto;">
<h1>Dipstick local OIDC stub &mdash; Sign in</h1>
<p>Local development only. No password is verified.</p>
<form method="post" action="/interaction/${uid}">
  <input type="hidden" name="prompt" value="login" />
  <label>Account id<br/><input type="text" name="login" value="${params.login_hint ?? ""}" /></label><br/><br/>
  <label>Password<br/><input type="password" name="password" /></label><br/><br/>
  <button type="submit">Sign in</button>
</form>
</body></html>`;
}

function renderConsentForm({ uid, params }) {
  return `<!doctype html>
<html><body style="font-family: sans-serif; max-width: 480px; margin: 3rem auto;">
<h1>Dipstick local OIDC stub &mdash; Authorize</h1>
<p>Client "${params.client_id}" is requesting access.</p>
<form method="post" action="/interaction/${uid}">
  <input type="hidden" name="prompt" value="consent" />
  <button type="submit">Allow access</button>
</form>
</body></html>`;
}

// Mirrors the removed devInteractions feature's own consent-submit logic
// (grant creation + scope/claims backfill) so the auto-approve path and the
// manual fallback form produce an equivalent grant.
async function grantConsent(provider, details, accountId) {
  const { params, grantId: existingGrantId, prompt } = details;
  let grant;
  if (existingGrantId) {
    grant = await provider.Grant.find(existingGrantId);
  } else {
    grant = new provider.Grant({ accountId, clientId: params.client_id });
  }
  if (prompt.details.missingOIDCScope) {
    grant.addOIDCScope(prompt.details.missingOIDCScope.join(" "));
  }
  if (prompt.details.missingOIDCClaims) {
    grant.addOIDCClaims(prompt.details.missingOIDCClaims);
  }
  if (prompt.details.missingResourceScopes) {
    for (const [indicator, scope] of Object.entries(prompt.details.missingResourceScopes)) {
      grant.addResourceScope(indicator, scope.join(" "));
    }
  }
  return grant.save();
}

// persona-login design.md D10: replaces the removed devInteractions feature
// (docker/oidc/server.js previously set features.devInteractions.enabled).
// When login_hint matches a known seeded account id, auto-resolves BOTH the
// login and consent interaction reasons via provider.interactionFinished() --
// this client requests offline_access, which always routes through a
// consent prompt on top of login, so resolving login alone would still
// leave a manual "allow access" screen and defeat one-click sign-in. Falls
// back to a minimal manual form -- equivalent to the removed
// devInteractions screens -- when login_hint is absent OR unrecognized
// (tasks.md 3.4/3.5: two distinct conditions, both routed to the same
// fallback branch, deliberately not conflated into a single
// `if (login_hint)` check).
export function createInteractionRouter(provider, accounts) {
  const router = new Router();

  router.get("/interaction/:uid", async (ctx) => {
    const details = await provider.interactionDetails(ctx.req, ctx.res);
    const { uid, prompt, params, session } = details;
    const hintedAccountId = resolveKnownAccountId(params.login_hint, accounts);

    if (prompt.name === "login") {
      if (hintedAccountId) {
        ctx.respond = false;
        await provider.interactionFinished(
          ctx.req,
          ctx.res,
          { login: { accountId: hintedAccountId } },
          { mergeWithLastSubmission: false },
        );
        return;
      }
      ctx.type = "html";
      ctx.body = renderLoginForm({ uid, params });
      return;
    }

    if (prompt.name === "consent") {
      // The original login_hint persists across the login -> consent
      // interaction transition (both reads come from the same underlying
      // authorization request params), so the same check applies here.
      if (hintedAccountId) {
        const grantId = await grantConsent(provider, details, hintedAccountId);
        ctx.respond = false;
        await provider.interactionFinished(
          ctx.req,
          ctx.res,
          { consent: { grantId } },
          { mergeWithLastSubmission: true },
        );
        return;
      }
      ctx.type = "html";
      ctx.body = renderConsentForm({ uid, params });
      return;
    }

    ctx.throw(501, "not implemented");
  });

  router.post("/interaction/:uid", async (ctx) => {
    const body = await readUrlencodedBody(ctx);
    const details = await provider.interactionDetails(ctx.req, ctx.res);
    const { prompt, session } = details;

    if (body.prompt === "login") {
      if (prompt.name !== "login") ctx.throw(400, "unexpected interaction state");
      ctx.respond = false;
      await provider.interactionFinished(
        ctx.req,
        ctx.res,
        { login: { accountId: body.login } },
        { mergeWithLastSubmission: false },
      );
      return;
    }

    if (body.prompt === "consent") {
      if (prompt.name !== "consent") ctx.throw(400, "unexpected interaction state");
      const grantId = await grantConsent(provider, details, session.accountId);
      ctx.respond = false;
      await provider.interactionFinished(
        ctx.req,
        ctx.res,
        { consent: { grantId } },
        { mergeWithLastSubmission: true },
      );
      return;
    }

    ctx.throw(501, "not implemented");
  });

  return router;
}
