export interface OAuthTokenResponse {
    access_token: string;
    refresh_token: string;
    id_token: string;
    expires_in: number;
    refresh_token_expires_in: number;
    token_type: string;
    scope: string;
}

export class SchwabClient {
    private clientId: string;
    private clientSecret: string;
    private redirectUri: string;
    private baseUrl = 'https://api.schwabapi.com';

    constructor(
        clientId = process.env.SCHWAB_CLIENT_ID || '',
        clientSecret = process.env.SCHWAB_CLIENT_SECRET || '',
        redirectUri = process.env.SCHWAB_REDIRECT_URI || 'https://127.0.0.1:8182/api/auth/schwab'
    ) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.redirectUri = redirectUri;
    }

    /**
     * Generates the authorization URL for the user to log in and grant access.
     */
    getAuthorizationUrl(): string {
        const params = new URLSearchParams({
            client_id: this.clientId,
            redirect_uri: this.redirectUri,
        });
        return `${this.baseUrl}/v1/oauth/authorize?${params.toString()}`;
    }

    /**
     * Exchanges an authorization code for an access token and refresh token.
     */
    async exchangeCodeForTokens(code: string): Promise<OAuthTokenResponse> {
        const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

        const params = new URLSearchParams();
        params.append('grant_type', 'authorization_code');
        params.append('code', code);
        params.append('redirect_uri', this.redirectUri);

        const response = await fetch(`${this.baseUrl}/v1/oauth/token`, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${credentials}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params.toString()
        });

        if (!response.ok) {
            throw new Error(`Failed to exchange code for tokens: ${response.statusText}`);
        }

        return response.json();
    }

    /**
     * Retrieves account information for all linked accounts.
     */
    async getAccounts(accessToken: string) {
        const response = await fetch(`${this.baseUrl}/trader/v1/accounts`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch accounts: ${response.statusText}`);
        }

        return response.json();
    }

    /**
     * Fetches real-time market quotes for a list of symbols.
     */
    async getQuotes(accessToken: string, symbols: string[]) {
        const response = await fetch(`${this.baseUrl}/marketdata/v1/quotes?symbols=${symbols.join(',')}`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch quotes: ${response.statusText}`);
        }

        return response.json();
    }

    /**
     * Places a trading order for a specific account.
     * The order structure follows Schwab's specification.
     */
    async placeOrder(accessToken: string, accountId: string, orderPayload: object) {
        const response = await fetch(`${this.baseUrl}/trader/v1/accounts/${accountId}/orders`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(orderPayload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to place order: ${response.statusText} - ${errorText}`);
        }

        // POST /orders returns 201 Created headers typically, maybe empty body
        return { success: true };
    }
}

export const schwabClient = new SchwabClient();
