import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
    orderInstrumentTypeSchema,
    orderSchema,
    orderSideSchema,
    orderTypeSchema,
    timeInForceSchema,
} from './execution';

describe('Execution Validators', () => {
    describe('orderSideSchema', () => {
        test('should accept valid sides', () => {
            assert.strictEqual(orderSideSchema.safeParse('buy').success, true);
            assert.strictEqual(orderSideSchema.safeParse('sell').success, true);
        });

        test('should reject invalid sides', () => {
            assert.strictEqual(orderSideSchema.safeParse('hold').success, false);
            assert.strictEqual(orderSideSchema.safeParse('').success, false);
        });
    });

    describe('orderTypeSchema', () => {
        test('should accept valid types', () => {
            assert.strictEqual(orderTypeSchema.safeParse('market').success, true);
            assert.strictEqual(orderTypeSchema.safeParse('limit').success, true);
            assert.strictEqual(orderTypeSchema.safeParse('stop').success, true);
            assert.strictEqual(orderTypeSchema.safeParse('stop_limit').success, true);
        });

        test('should reject invalid types', () => {
            assert.strictEqual(orderTypeSchema.safeParse('trailing_stop').success, false);
        });
    });

    describe('orderInstrumentTypeSchema', () => {
        test('should accept equity and option instruments', () => {
            assert.strictEqual(orderInstrumentTypeSchema.safeParse('equity').success, true);
            assert.strictEqual(orderInstrumentTypeSchema.safeParse('option').success, true);
        });

        test('should reject unsupported instruments', () => {
            assert.strictEqual(orderInstrumentTypeSchema.safeParse('crypto').success, false);
        });
    });

    describe('timeInForceSchema', () => {
        test('should accept valid TIF values', () => {
            assert.strictEqual(timeInForceSchema.safeParse('day').success, true);
            assert.strictEqual(timeInForceSchema.safeParse('gtc').success, true);
            assert.strictEqual(timeInForceSchema.safeParse('ioc').success, true);
            assert.strictEqual(timeInForceSchema.safeParse('fok').success, true);
        });

        test('should reject invalid TIF values', () => {
            assert.strictEqual(timeInForceSchema.safeParse('good_until_canceled').success, false);
        });
    });

    describe('orderSchema', () => {
        const validBaseOrder = {
            ticker: 'AAPL',
            side: 'buy',
            type: 'market',
            quantity: '10',
            timeInForce: 'day'
        };

        test('should accept a valid market order', () => {
            const result = orderSchema.safeParse(validBaseOrder);
            assert.strictEqual(result.success, true);
            if (result.success) {
                assert.strictEqual(result.data.quantity, 10);
            }
        });

        test('should accept a valid limit order', () => {
            const limitOrder = {
                ...validBaseOrder,
                type: 'limit',
                limitPrice: '150.50'
            };
            const result = orderSchema.safeParse(limitOrder);
            assert.strictEqual(result.success, true);
            if (result.success) {
                assert.strictEqual(result.data.limitPrice, 150.50);
            }
        });

        test('should accept a valid stop order', () => {
            const stopOrder = {
                ...validBaseOrder,
                type: 'stop',
                stopPrice: '140.00'
            };
            const result = orderSchema.safeParse(stopOrder);
            assert.strictEqual(result.success, true);
            if (result.success) {
                assert.strictEqual(result.data.stopPrice, 140.00);
            }
        });

        test('should accept a valid stop_limit order', () => {
            const stopLimitOrder = {
                ...validBaseOrder,
                type: 'stop_limit',
                limitPrice: '150.00',
                stopPrice: '145.00'
            };
            const result = orderSchema.safeParse(stopLimitOrder);
            assert.strictEqual(result.success, true);
        });

        describe('Ticker validation', () => {
            test('should reject empty ticker', () => {
                const result = orderSchema.safeParse({ ...validBaseOrder, ticker: '' });
                assert.strictEqual(result.success, false);
            });

            test('should reject ticker that is too long', () => {
                const result = orderSchema.safeParse({ ...validBaseOrder, ticker: 'TOOLONGTICKER' });
                assert.strictEqual(result.success, false);
            });

            test('should reject ticker with invalid characters', () => {
                assert.strictEqual(orderSchema.safeParse({ ...validBaseOrder, ticker: 'AAPL!' }).success, false);
                assert.strictEqual(orderSchema.safeParse({ ...validBaseOrder, ticker: 'aapl' }).success, false);
            });

            test('should reject unsafe ticker (HTML)', () => {
                const result = orderSchema.safeParse({ ...validBaseOrder, ticker: '<TAG>' });
                assert.strictEqual(result.success, false);
            });

            test('should reject ticker starting with equals', () => {
                const result = orderSchema.safeParse({ ...validBaseOrder, ticker: '=AAPL' });
                assert.strictEqual(result.success, false);
            });
        });

        describe('Quantity validation', () => {
            test('should reject non-numeric quantity', () => {
                assert.strictEqual(orderSchema.safeParse({ ...validBaseOrder, quantity: 'abc' }).success, false);
            });

            test('should reject non-integer quantity', () => {
                assert.strictEqual(orderSchema.safeParse({ ...validBaseOrder, quantity: '10.5' }).success, false);
            });

            test('should reject zero or negative quantity', () => {
                assert.strictEqual(orderSchema.safeParse({ ...validBaseOrder, quantity: '0' }).success, false);
                assert.strictEqual(orderSchema.safeParse({ ...validBaseOrder, quantity: '-5' }).success, false);
            });

            test('should reject too large quantity', () => {
                assert.strictEqual(orderSchema.safeParse({ ...validBaseOrder, quantity: '1000001' }).success, false);
            });
        });

        describe('Price validation', () => {
            test('should reject negative limit price', () => {
                const result = orderSchema.safeParse({ ...validBaseOrder, type: 'limit', limitPrice: '-10' });
                assert.strictEqual(result.success, false);
            });

            test('should reject zero limit price', () => {
                const result = orderSchema.safeParse({ ...validBaseOrder, type: 'limit', limitPrice: '0' });
                assert.strictEqual(result.success, false);
            });

            test('should reject negative stop price', () => {
                const result = orderSchema.safeParse({ ...validBaseOrder, type: 'stop', stopPrice: '-10' });
                assert.strictEqual(result.success, false);
            });
        });

        describe('Conditional validation (superRefine)', () => {
            test('should reject limit order without limitPrice', () => {
                const result = orderSchema.safeParse({ ...validBaseOrder, type: 'limit' });
                assert.strictEqual(result.success, false);
                if (!result.success) {
                    assert.ok(result.error.issues.some(i => i.path.includes('limitPrice')));
                }
            });

            test('should reject stop order without stopPrice', () => {
                const result = orderSchema.safeParse({ ...validBaseOrder, type: 'stop' });
                assert.strictEqual(result.success, false);
                if (!result.success) {
                    assert.ok(result.error.issues.some(i => i.path.includes('stopPrice')));
                }
            });

            test('should reject stop_limit order without limitPrice or stopPrice', () => {
                const noLimit = orderSchema.safeParse({ ...validBaseOrder, type: 'stop_limit', stopPrice: '100' });
                assert.strictEqual(noLimit.success, false);

                const noStop = orderSchema.safeParse({ ...validBaseOrder, type: 'stop_limit', limitPrice: '100' });
                assert.strictEqual(noStop.success, false);
            });
        });

        describe('Option policy validation (AR-143)', () => {
            const validOptionOrder = {
                ...validBaseOrder,
                instrumentType: 'option',
                type: 'limit',
                limitPrice: '4.50',
                optionContractType: 'call',
                optionStrike: '250',
                optionExpiry: '2027-01-15',
                optionPremium: '4.50',
                linkedThesisId: 'seed-aapl',
                maxLossAcknowledged: true,
                whatMustBeTrueByExpiry: 'Services growth must re-rate earnings by expiry.',
                plannedExitRule: 'Exit at 50% loss or roll 90 days before expiry.',
            };

            test('should accept a fully documented long option order', () => {
                const result = orderSchema.safeParse(validOptionOrder);
                assert.strictEqual(result.success, true);
                if (result.success) {
                    assert.strictEqual(result.data.instrumentType, 'option');
                    assert.strictEqual(result.data.optionPremium, 4.5);
                    assert.strictEqual(result.data.optionStrike, 250);
                }
            });

            test('should reject option orders missing thesis, max-loss acknowledgement, and expiry rules', () => {
                const result = orderSchema.safeParse({
                    ...validBaseOrder,
                    instrumentType: 'option',
                    type: 'limit',
                    limitPrice: '4.50',
                    optionContractType: 'call',
                    optionStrike: '250',
                    optionExpiry: '2027-01-15',
                    optionPremium: '4.50',
                });
                assert.strictEqual(result.success, false);
                if (!result.success) {
                    const paths = result.error.issues.map((issue) => issue.path.join('.'));
                    assert.ok(paths.includes('linkedThesisId'));
                    assert.ok(paths.includes('maxLossAcknowledged'));
                    assert.ok(paths.includes('whatMustBeTrueByExpiry'));
                    assert.ok(paths.includes('plannedExitRule'));
                }
            });

            test('should reject short option orders in the v1 flow', () => {
                const result = orderSchema.safeParse({
                    ...validOptionOrder,
                    side: 'sell',
                });
                assert.strictEqual(result.success, false);
                if (!result.success) {
                    assert.ok(result.error.issues.some((issue) => issue.path.includes('side')));
                }
            });
        });
    });
});
