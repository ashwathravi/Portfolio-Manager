import { describe, test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { parseThirteenFInformationTable, ThirteenFParseError } from './thirteenf-parser';

const FILING_ID = '22222222-2222-4222-8222-222222222222';
const FIXTURE_DIR = 'src/lib/sec/fixtures';
const CONTEXT = {
    filingId: FILING_ID,
    accessionNumber: '0000950123-26-000001',
    filerName: 'Berkshire Hathaway Inc',
    reportPeriod: '2025-Q4',
};

const REPRESENTATIVE_XML = readFileSync(`${FIXTURE_DIR}/berkshire-2025q4-information-table.xml`, 'utf8');
const REPRESENTATIVE_EXPECTED = JSON.parse(
    readFileSync(`${FIXTURE_DIR}/berkshire-2025q4-parsed-holdings.json`, 'utf8'),
) as {
    filingId: string;
    accessionNumber: string;
    reportPeriod: string;
    totalValueUsd: number;
    holdings: Array<Record<string, unknown>>;
};

function comparableHolding(holding: ReturnType<typeof parseThirteenFInformationTable>['holdings'][number]) {
    return JSON.parse(JSON.stringify({
        issuerName: holding.issuerName,
        cusip: holding.cusip,
        ticker: holding.ticker,
        valueUsd: holding.valueUsd,
        shares: holding.shares,
        securityType: holding.securityType,
        investmentDiscretion: holding.investmentDiscretion,
        putCall: holding.putCall,
        votingAuthoritySole: holding.votingAuthoritySole,
        votingAuthorityShared: holding.votingAuthorityShared,
        votingAuthorityNone: holding.votingAuthorityNone,
        positionRank: holding.positionRank,
        rawValue: holding.rawHolding.rawValue,
        valueUnit: holding.rawHolding.valueUnit,
    })) as Record<string, unknown>;
}

describe('parseThirteenFInformationTable', () => {
    test('parses representative 13F XML into normalized holdings', () => {
        const result = parseThirteenFInformationTable(REPRESENTATIVE_XML, {
            ...CONTEXT,
            tickerByCusip: {
                '037833100': 'aapl',
                '166764100': 'CVX',
            },
        });

        assert.strictEqual(result.filingId, FILING_ID);
        assert.strictEqual(result.accessionNumber, CONTEXT.accessionNumber);
        assert.strictEqual(result.reportPeriod, '2025-Q4');
        assert.strictEqual(result.holdings.length, 2);
        assert.strictEqual(result.totalValueUsd, 192000000000);
        assert.deepStrictEqual(
            {
                filingId: result.filingId,
                accessionNumber: result.accessionNumber,
                reportPeriod: result.reportPeriod,
                totalValueUsd: result.totalValueUsd,
                holdings: result.holdings.map(comparableHolding),
            },
            REPRESENTATIVE_EXPECTED,
        );

        const [apple, chevron] = result.holdings;
        assert.strictEqual(apple.issuerName, 'APPLE INC');
        assert.strictEqual(apple.cusip, '037833100');
        assert.strictEqual(apple.ticker, 'AAPL');
        assert.strictEqual(apple.valueUsd, 174000000000);
        assert.strictEqual(apple.shares, 915600000);
        assert.strictEqual(apple.securityType, 'COM');
        assert.strictEqual(apple.investmentDiscretion, 'SOLE');
        assert.strictEqual(apple.votingAuthoritySole, 915600000);
        assert.strictEqual(apple.positionRank, 1);
        assert.strictEqual(apple.rawHolding.rawValue, '174000000');
        assert.strictEqual(apple.rawHolding.valueUnit, 'thousands_usd');

        assert.strictEqual(chevron.ticker, 'CVX');
        assert.strictEqual(chevron.putCall, 'put');
        assert.strictEqual(chevron.votingAuthorityShared, 100);
        assert.strictEqual(chevron.positionRank, 2);
    });

    test('sorts deterministically by value and uses CUSIP resolver hooks', () => {
        const result = parseThirteenFInformationTable(REPRESENTATIVE_XML, {
            ...CONTEXT,
            tickerByCusip: (cusip) => cusip === '166764100' ? 'cvx' : undefined,
        });

        assert.deepStrictEqual(
            result.holdings.map((holding) => [holding.positionRank, holding.cusip, holding.ticker]),
            [
                [1, '037833100', undefined],
                [2, '166764100', 'CVX'],
            ],
        );
    });

    test('handles namespaced SEC XML and entity decoding', () => {
        const xml = `<?xml version="1.0"?>
<ns1:informationTable>
  <ns1:infoTable>
    <ns1:nameOfIssuer><![CDATA[ALPHABET &amp; CO]]></ns1:nameOfIssuer>
    <ns1:titleOfClass>CL A</ns1:titleOfClass>
    <ns1:cusip>02079K305</ns1:cusip>
    <ns1:value>1,250</ns1:value>
    <ns1:shrsOrPrnAmt>
      <ns1:sshPrnamt>10,000</ns1:sshPrnamt>
      <ns1:sshPrnamtType>SH</ns1:sshPrnamtType>
    </ns1:shrsOrPrnAmt>
    <ns1:investmentDiscretion>SOLE</ns1:investmentDiscretion>
    <ns1:votingAuthority>
      <ns1:Sole>10,000</ns1:Sole>
      <ns1:Shared>0</ns1:Shared>
      <ns1:None>0</ns1:None>
    </ns1:votingAuthority>
  </ns1:infoTable>
</ns1:informationTable>`;

        const result = parseThirteenFInformationTable(xml, CONTEXT);

        assert.strictEqual(result.holdings.length, 1);
        assert.strictEqual(result.holdings[0].issuerName, 'ALPHABET & CO');
        assert.strictEqual(result.holdings[0].cusip, '02079K305');
        assert.strictEqual(result.holdings[0].valueUsd, 1250000);
        assert.strictEqual(result.holdings[0].shares, 10000);
    });

    test('allows unknown ticker mappings while preserving issuer and CUSIP search keys', () => {
        const result = parseThirteenFInformationTable(REPRESENTATIVE_XML, CONTEXT);

        assert.strictEqual(result.holdings[0].ticker, undefined);
        assert.strictEqual(result.holdings[0].issuerName, 'APPLE INC');
        assert.strictEqual(result.holdings[0].cusip, '037833100');
    });

    test('throws contextual errors for malformed XML', () => {
        assert.throws(
            () => parseThirteenFInformationTable('<informationTable><infoTable><nameOfIssuer>Bad</nameOfIssuer>', CONTEXT),
            (error: unknown) => error instanceof ThirteenFParseError
                && error.accessionNumber === CONTEXT.accessionNumber
                && error.message.includes('opening infoTable tag'),
        );
    });

    test('throws contextual errors for missing required fields', () => {
        const xml = `<informationTable>
  <infoTable>
    <nameOfIssuer>APPLE INC</nameOfIssuer>
    <cusip>037833100</cusip>
    <value>1000</value>
  </infoTable>
</informationTable>`;

        assert.throws(
            () => parseThirteenFInformationTable(xml, CONTEXT),
            (error: unknown) => error instanceof ThirteenFParseError
                && error.field === 'sshPrnamt'
                && error.rowIndex === 0
                && error.message.includes(CONTEXT.accessionNumber),
        );
    });

    test('throws contextual errors for invalid numeric fields', () => {
        const xml = REPRESENTATIVE_XML.replace('<value>174000000</value>', '<value>not-a-number</value>');

        assert.throws(
            () => parseThirteenFInformationTable(xml, CONTEXT),
            (error: unknown) => error instanceof ThirteenFParseError
                && error.field === 'value'
                && error.message.includes('Berkshire Hathaway Inc'),
        );
    });

    test('round-trips parsed holdings through JSON without losing fidelity-critical fields', () => {
        const result = parseThirteenFInformationTable(REPRESENTATIVE_XML, CONTEXT);
        const roundTripped = JSON.parse(JSON.stringify(result.holdings)) as typeof result.holdings;

        assert.strictEqual(roundTripped[0].cusip, result.holdings[0].cusip);
        assert.strictEqual(roundTripped[0].issuerName, result.holdings[0].issuerName);
        assert.strictEqual(roundTripped[0].valueUsd, result.holdings[0].valueUsd);
        assert.strictEqual(roundTripped[0].shares, result.holdings[0].shares);
        assert.strictEqual(roundTripped[0].rawHolding.rawValue, '174000000');
    });
});
