import { Core } from '@strapi/strapi';
import jwt from 'jsonwebtoken';

interface TokenCache {
  token: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

export default ({ strapi }: { strapi: Core.Strapi }) => {
  const owner = strapi.config.get<string>('plugin.my-github-actions-dispatcher.owner');
  const repo = strapi.config.get<string>('plugin.my-github-actions-dispatcher.repo');
  const appId = strapi.config.get<string>('plugin.my-github-actions-dispatcher.appId');
  const installationId = strapi.config.get<string>('plugin.my-github-actions-dispatcher.installationId');
  const privateKey = strapi.config.get<string>('plugin.my-github-actions-dispatcher.privateKey');

  const generateJwt = (): string => {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iat: now - 60,
      exp: now + (10 * 60),
      iss: appId,
    };
    return jwt.sign(payload, privateKey, { algorithm: 'RS256' });
  };

  const getInstallationAccessToken = async (): Promise<string> => {
    const appJwt = generateJwt();
    const url = `https://api.github.com/app/installations/${installationId}/access_tokens`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${appJwt}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Failed to get installation access token: ${response.status} ${errorBody}`);
    }

    const data = await response.json() as any;
    return data.token;
  };

  const getAuthToken = async (): Promise<string> => {
    if (tokenCache && tokenCache.expiresAt > Date.now()) {
      return tokenCache.token;
    }

    const newToken = await getInstallationAccessToken();
    tokenCache = {
      token: newToken,
      expiresAt: Date.now() + (55 * 60 * 1000), 
    };
    
    return tokenCache.token;
  };


  return {
    async triggerDispatch(eventType: string, clientPayload: object = {}) {
      if (!owner || !repo || !appId || !installationId || !privateKey) {
        strapi.log.error('My GitHub Actions Dispatcher: Plugin is not fully configured for GitHub App.');
        return { success: false, message: 'Plugin not configured.' };
      }

      try {
        const authToken = await getAuthToken();
        const url = `https://api.github.com/repos/${owner}/${repo}/dispatches`;

        strapi.log.info(`Triggering GitHub Action with GitHub App: ${eventType}`);

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            event_type: eventType,
            client_payload: clientPayload,
          }),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(`GitHub API responded with ${response.status}: ${errorBody}`);
        }

        strapi.log.info(`Successfully triggered GitHub Action for event: ${eventType}`);
        return { success: true, message: `Dispatch event '${eventType}' sent successfully.` };

      } catch (error) {
        strapi.log.error('Failed to trigger GitHub Action dispatch.');
        if (error instanceof Error) {
          strapi.log.error(error.message);
        }
        return { success: false, message: 'Failed to send dispatch event.' };
      }
    },
  };
};