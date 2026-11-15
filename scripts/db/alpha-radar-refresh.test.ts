import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import * as schema from '../../src/db/schema';
import type { AlphaRadarEmbeddingProvider } from '../../src/lib/alpha-radar/memory';
import { DrizzleAlphaRadarSemanticMemoryRepository } from '../../src/lib/alpha-radar/memory-repository';
import { AlphaRadarRefreshService } from '../../src/lib/alpha-radar/refresh';
import { DrizzleAlphaRadarReportRepository } from '../../src/lib/alpha-radar/report-repository';
import { DrizzleAlphaRadarDataRepository } from '../../src/lib/alpha-radar/repository';
import { AlphaRadarSecIngestionService, DrizzleSecFilingRepository, SecEdgarClient, type SecFetch } from '../../src/lib/sec';

// Launch item i62: the daily SEC job, from SEC's answers (as SEC files a 13F
// today: the cover page as the primary document, the information table as
// a numbered attachment) to holdings, changes, a report and evidence memory,
// against a scratch database with every migration applied. Needs a local
// Postgres it may create databases in; CI's e2e job sets this.
// Locally: SCRIPTS_TEST_DATABASE_URL=postgres://atlas:atlas-local-only@127.0.0.1:54329/atlas_wealth
const DATABASE_URL = process.env.SCRIPTS_TEST_DATABASE_URL?.trim();

const FILER_ID = '7b0c4b52-3c4b-4b8e-9a51-3f9e8f3a6b01';
const ARCHIVES = 'https://www.sec.gov/Archives/edgar/data/1067983';

interface Quarter {
    accession: string;
    reportDate: string;
    table: string;
    holdings: Array<[issuer: string, cusip: string, valueThousands: number, shares: number]>;
}

const Q1: Quarter = {
    accession: '0001193125-26-226661',
    reportDate: '2026-03-31',
    table: '48812.xml',
    holdings: [
        ['APPLE INC', '037833100', 60_000_000, 280_000_000],
        ['CHEVRON CORP NEW', '166764100', 18_000_000, 118_000_000],
        ['OCCIDENTAL PETE CORP', '674599105', 10_000_000, 264_000_000],
    ],
};
const Q2: Quarter = {
    accession: '0001193125-26-352200',
    reportDate: '2026-06-30',
    table: '56757.xml',
    holdings: [
        ['APPLE INC', '037833100', 55_000_000, 250_000_000],
        ['CHUBB LIMITED', 'H1467J104', 7_800_000, 27_000_000],
        ['OCCIDENTAL PETE CORP', '674599105', 10_000_000, 264_000_000],
    ],
};
const Q3: Quarter = {
    accession: '0001193125-26-470001',
    reportDate: '2026-09-30',
    table: '61200.xml',
    holdings: [['CHUBB LIMITED', 'H1467J104', 9_000_000, 31_000_000]],
};

const folder = (quarter: Quarter) => `${ARCHIVES}/${quarter.accession.replaceAll('-', '')}`;

function informationTable(quarter: Quarter): string {
    const rows = quarter.holdings.map(([issuer, cusip, value, shares]) => `
  <infoTable>
    <nameOfIssuer>${issuer}</nameOfIssuer>
    <titleOfClass>COM</titleOfClass>
    <cusip>${cusip}</cusip>
    <value>${value}</value>
    <shrsOrPrnAmt><sshPrnamt>${shares}</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt>
    <investmentDiscretion>DFND</investmentDiscretion>
    <votingAuthority><Sole>${shares}</Sole><Shared>0</Shared><None>0</None></votingAuthority>
  </infoTable>`).join('');
    return `<?xml version="1.0" encoding="UTF-8"?>
<informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable">${rows}
</informationTable>`;
}

function headerIndex(quarter: Quarter, listsTable = true): string {
    const table = listsTable
        ? `&lt;DOCUMENT&gt;\n&lt;TYPE&gt;INFORMATION TABLE\n&lt;SEQUENCE&gt;2\n&lt;FILENAME&gt;${quarter.table}\n&lt;/DOCUMENT&gt;\n`
        : '';
    return `<HTML><BODY><PRE>&lt;SEC-HEADER&gt;\nACCESSION NUMBER:\t\t${quarter.accession}\n&lt;/SEC-HEADER&gt;
&lt;DOCUMENT&gt;\n&lt;TYPE&gt;13F-HR\n&lt;SEQUENCE&gt;1\n&lt;FILENAME&gt;primary_doc.xml\n&lt;/DOCUMENT&gt;
${table}</PRE></BODY></HTML>`;
}

/** SEC as far as the job asks it: the filer's submissions, each filing's indexes and tables. */
class FakeSec {
    quarters: Quarter[] = [Q2, Q1];
    /** Filings whose header index doesn't list the table yet. */
    unlisted = new Set<string>();
    requests: string[] = [];

    readonly fetch: SecFetch = async (url) => {
        this.requests.push(url);
        if (url === 'https://data.sec.gov/submissions/CIK0001067983.json') {
            const field = (pick: (quarter: Quarter) => string) => this.quarters.map(pick);
            return Response.json({
                cik: '1067983',
                name: 'BERKSHIRE HATHAWAY INC',
                filings: {
                    recent: {
                        accessionNumber: field((quarter) => quarter.accession),
                        filingDate: field(() => '2026-11-05'),
                        reportDate: field((quarter) => quarter.reportDate),
                        acceptanceDateTime: field(() => '2026-08-14T16:05:04.000Z'),
                        form: field(() => '13F-HR'),
                        primaryDocument: field(() => 'xslForm13F_X02/primary_doc.xml'),
                        primaryDocDescription: field(() => ''),
                    },
                },
            });
        }
        for (const quarter of this.quarters) {
            if (url === `${folder(quarter)}/${quarter.accession}-index-headers.html`) {
                return new Response(headerIndex(quarter, !this.unlisted.has(quarter.accession)));
            }
            if (url === `${folder(quarter)}/index.json`) {
                return Response.json({ directory: { item: [{ name: 'primary_doc.xml' }, { name: 'a.xml' }, { name: 'b.xml' }] } });
            }
        }
        return new Response('not found', { status: 404 });
    };

    /** The information tables, as the job fetches them (refresh.ts, defaultFetchInformationTableXml). */
    readonly fetchTable = async (input: RequestInfo | URL): Promise<Response> => {
        const url = String(input);
        this.requests.push(url);
        const quarter = this.quarters.find((candidate) => url === `${folder(candidate)}/${candidate.table}`);
        return quarter ? new Response(informationTable(quarter)) : new Response('not found', { status: 404 });
    };
}

describe('Alpha Radar daily refresh into the database', { skip: !DATABASE_URL && 'SCRIPTS_TEST_DATABASE_URL is not set', timeout: 120_000 }, () => {
    const name = `alpha_radar_refresh_test_${process.pid}`;
    let server: ReturnType<typeof postgres>;
    let sql: ReturnType<typeof postgres>;
    let database: ConstructorParameters<typeof DrizzleAlphaRadarDataRepository>[0];
    const sec = new FakeSec();
    const saved = { fetch: globalThis.fetch, userAgent: process.env.SEC_EDGAR_USER_AGENT };

    function refresh(embeddings: AlphaRadarEmbeddingProvider | null = null) {
        const service = new AlphaRadarRefreshService({
            secIngestion: new AlphaRadarSecIngestionService(
                new SecEdgarClient({ userAgent: 'Atlas Wealth test contact@example.com', fetcher: sec.fetch, minRequestIntervalMs: 0, maxRetries: 0 }),
                new DrizzleSecFilingRepository(database),
            ),
            repository: new DrizzleAlphaRadarDataRepository(database),
            reportRepository: new DrizzleAlphaRadarReportRepository(database),
            memory: new DrizzleAlphaRadarSemanticMemoryRepository(database),
            embeddings,
            reportError: (error) => { throw error; },
            filingLimit: 3,
        });
        return service.refreshFiler(FILER_ID);
    }

    const filings = () => sql`
        SELECT accession_number, report_period, status, information_table_url, parse_error
        FROM alpha_radar_sec_filings ORDER BY report_period`;

    before(async () => {
        globalThis.fetch = sec.fetchTable as typeof fetch;
        process.env.SEC_EDGAR_USER_AGENT = 'Atlas Wealth test contact@example.com';
        server = postgres(DATABASE_URL!, { max: 1, onnotice: () => {} });
        await server.unsafe(`DROP DATABASE IF EXISTS ${name}`);
        await server.unsafe(`CREATE DATABASE ${name}`);
        const scratch = new URL(DATABASE_URL!);
        scratch.pathname = `/${name}`;
        sql = postgres(scratch.toString(), { max: 1, onnotice: () => {} });
        await sql.unsafe(readFileSync('scripts/db/init-local.sql', 'utf8'));
        await migrate(drizzle(sql), { migrationsFolder: 'drizzle' });
        database = drizzle(sql, { schema }) as typeof database;
        await sql`
            INSERT INTO alpha_radar_tracked_filers (id, name, slug, cik, enabled)
            VALUES (${FILER_ID}, 'Berkshire Hathaway', 'berkshire-hathaway', '0001067983', true)`;
    });

    after(async () => {
        globalThis.fetch = saved.fetch;
        if (saved.userAgent === undefined) delete process.env.SEC_EDGAR_USER_AGENT;
        else process.env.SEC_EDGAR_USER_AGENT = saved.userAgent;
        await sql?.end();
        await server?.unsafe(`DROP DATABASE IF EXISTS ${name}`);
        await server?.end();
    });

    test('regression: each filing is parsed from its information table attachment, the oldest quarter first', async () => {
        const result = await refresh();

        assert.deepEqual(result.errors, []);
        assert.ok(!sec.requests.some((url) => url.includes('primary_doc.xml')), 'the cover page is never read as the table');
        assert.deepEqual(result.filers[0].filings.map((filing) => [filing.reportPeriod, filing.status]), [['2026-Q1', 'parsed'], ['2026-Q2', 'parsed']]);
        assert.deepEqual((await filings()).map((row) => [row.report_period, row.status, row.information_table_url]), [
            ['2026-Q1', 'parsed', `${folder(Q1)}/48812.xml`],
            ['2026-Q2', 'parsed', `${folder(Q2)}/56757.xml`],
        ]);

        // Q2 counted from Q1, which was parsed first.
        const changes = await sql`
            SELECT issuer_name, change_type FROM alpha_radar_holding_changes
            WHERE report_period = '2026-Q2' ORDER BY issuer_name`;
        assert.deepEqual(changes.map((row) => [row.issuer_name, row.change_type]), [
            ['APPLE INC', 'decreased'],
            ['CHEVRON CORP NEW', 'exited'],
            ['CHUBB LIMITED', 'new'],
            ['OCCIDENTAL PETE CORP', 'unchanged'],
        ]);
    });

    test('the holdings and reports are evidence memory, found by keyword with the table as their source', async () => {
        const counts = await sql`
            SELECT c.report_period, c.source_kind, count(*)::int AS chunks, bool_and(c.embedding IS NULL) AS unembedded
            FROM alpha_radar_semantic_chunks c GROUP BY 1, 2 ORDER BY 1, 2`;
        assert.deepEqual(counts.map((row) => [row.report_period, row.source_kind, row.chunks > 0, row.unembedded]), [
            ['2026-Q1', 'filing-text', true, true],
            ['2026-Q1', 'memo-section', true, true],
            ['2026-Q2', 'filing-text', true, true],
            ['2026-Q2', 'memo-section', true, true],
        ]);

        const memory = new DrizzleAlphaRadarSemanticMemoryRepository(database);
        const search = await memory.search({ query: 'CHUBB', limit: 3, filters: { trackedFilerIds: [FILER_ID], reportPeriods: ['2026-Q2'] } });
        assert.equal(search.provider, 'keyword-fallback');
        const holdings = search.matches.find((match) => match.sourceKind === 'filing-text');
        assert.match(holdings?.text ?? '', /CHUBB LIMITED CUSIP H1467J104 \$7,800,000,000/);
        assert.equal(holdings?.citation.url, `${folder(Q2)}/56757.xml`);

        // Newest quarter first.
        assert.equal((await memory.listChunks())[0].reportPeriod, '2026-Q2');
    });

    test('regression: a refresh with nothing new keeps the filings parsed, so the next quarter is counted from them', async () => {
        const result = await refresh();

        assert.deepEqual([result.parsed, result.skipped], [0, 2]);
        assert.deepEqual((await filings()).map((row) => row.status), ['parsed', 'parsed']);
    });

    test('regression: when SEC can\'t say where a parsed filing\'s table is, the one found before stays, and so does its status', async () => {
        sec.unlisted.add(Q2.accession);
        const result = await refresh();
        sec.unlisted.clear();

        assert.deepEqual([result.parsed, result.errors], [0, []]);
        assert.deepEqual((await filings()).map((row) => [row.report_period, row.status, row.information_table_url]), [
            ['2026-Q1', 'parsed', `${folder(Q1)}/48812.xml`],
            ['2026-Q2', 'parsed', `${folder(Q2)}/56757.xml`],
        ]);
    });

    test('a filing SEC lists no table for fails by name, and is parsed once SEC lists one', async () => {
        sec.quarters = [Q3, Q2, Q1];
        sec.unlisted.add(Q3.accession);
        const missing = await refresh();

        const [q3] = (await filings()).filter((row) => row.report_period === '2026-Q3');
        assert.deepEqual([q3.status, q3.information_table_url], ['failed', null]);
        assert.match(q3.parse_error, /SEC lists no information table among the documents of filing 0001193125-26-470001/);
        assert.equal(missing.errors.length, 1);

        // The next day, unchanged: not tried again.
        assert.equal((await refresh()).parsed, 0);

        sec.unlisted.clear();
        const listed = await refresh();
        assert.equal(listed.parsed, 1);
        const [parsed] = (await filings()).filter((row) => row.report_period === '2026-Q3');
        assert.deepEqual([parsed.status, parsed.information_table_url, parsed.parse_error], ['parsed', `${folder(Q3)}/61200.xml`, null]);
        const chubb = await sql`SELECT change_type FROM alpha_radar_holding_changes WHERE report_period = '2026-Q3' AND cusip = 'H1467J104'`;
        assert.equal(chubb[0].change_type, 'increased');
    });

    test('with embeddings on, a filing\'s memory is stored embedded and searched by meaning too', async () => {
        const embeddings: AlphaRadarEmbeddingProvider = {
            name: 'ai-gateway',
            model: 'test/embed',
            dimensions: 0,
            isEnabled: () => true,
            embedTexts: async (texts) => texts.map((text) => (/chubb|insur/i.test(text) ? [1, 0] : [0, 1])),
        };
        await sql`UPDATE alpha_radar_sec_filings SET status = 'discovered', information_table_url = NULL WHERE report_period = '2026-Q3'`;
        assert.equal((await refresh(embeddings)).parsed, 1);

        const stored = await sql`
            SELECT source_kind, embedding_model, embedding_dimensions, jsonb_array_length(embedding) AS length
            FROM alpha_radar_semantic_chunks WHERE report_period = '2026-Q3'`;
        assert.ok(stored.length > 0);
        assert.ok(stored.every((row) => row.embedding_model === 'test/embed' && row.embedding_dimensions === 2 && row.length === 2));

        const search = await new DrizzleAlphaRadarSemanticMemoryRepository(database).search({
            query: 'property insurers',
            queryEmbedding: [1, 0],
            embeddingModel: 'test/embed',
            filters: { reportPeriods: ['2026-Q3'] },
        });
        assert.equal(search.provider, 'embeddings');
        assert.match(search.matches[0].text, /CHUBB/);
    });
});
