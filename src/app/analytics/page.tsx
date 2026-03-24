'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { StatCard } from '@/components/data-display/StatCard';
import { Settings, Plus, ChevronLeft, ChevronRight, Share2, TrendingUp, Calendar as CalendarIcon } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';

// Trades keyed by month index (0=Jan 2026, 1=Feb 2026 …) then day-of-month
const TRADE_DATA: Record<number, Record<number, { pnl: number; trades: number }>> = {
    1: { // February 2026
        6:  { pnl: 222704, trades: 2 },
        20: { pnl: -3200,  trades: 1 },
    },
    0: { // January 2026
        14: { pnl: 5400,  trades: 1 },
        21: { pnl: -1200, trades: 1 },
        28: { pnl: 8750,  trades: 2 },
    },
};

const MONTH_LABELS = ['Jan 2026', 'Feb 2026', 'Mar 2026'];

// Days in each month (index 0=Jan, 1=Feb, 2=Mar)
const MONTH_DAYS = [31, 28, 31];

// Which weekday the month starts on (0=Sun): Jan=4, Feb=0, Mar=0
const MONTH_START_DAY = [4, 0, 0];

function fmt(n: number) {
    return (n >= 0 ? '+' : '-') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function TradeAnalyticsPage() {
    const router = useRouter();
    const [monthIndex, setMonthIndex] = useState(1); // Feb 2026
    const [selectedDay, setSelectedDay] = useState<number | null>(6);
    const [heatmapYear, setHeatmapYear] = useState(2026);

    const monthTrades = TRADE_DATA[monthIndex] ?? {};
    const totalPnl    = Object.values(monthTrades).reduce((s, t) => s + t.pnl, 0);
    const totalTrades = Object.values(monthTrades).reduce((s, t) => s + t.trades, 0);
    const tradingDays = Object.keys(monthTrades).length;
    const winners     = Object.values(monthTrades).filter((t) => t.pnl > 0).length;
    const winRate     = tradingDays > 0 ? ((winners / tradingDays) * 100).toFixed(1) : '0.0';
    const bestDay     = Object.entries(monthTrades).sort((a, b) => b[1].pnl - a[1].pnl)[0];
    const bestDayPnl  = bestDay ? bestDay[1].pnl : 0;
    const bestDayNum  = bestDay ? Number(bestDay[0]) : null;
    const selectedTrade = selectedDay !== null ? monthTrades[selectedDay] ?? null : null;

    const daysInMonth  = MONTH_DAYS[monthIndex] ?? 30;
    const startWeekday = MONTH_START_DAY[monthIndex] ?? 0;

    // Build calendar cells: leading blanks + days
    const calendarCells: (number | null)[] = [
        ...Array(startWeekday).fill(null),
        ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
    ];
    // Pad to full weeks
    while (calendarCells.length % 7 !== 0) calendarCells.push(null);

    return (
        <div className="space-y-6 p-6">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Trade Analytics</h1>
                <p className="text-muted-foreground">
                    Detailed breakdown of your trades and execution patterns
                </p>
            </div>

            {/* Trading Activity - Year Heatmap */}
            <Card className="p-6">
                <div className="mb-6">
                    <div className="flex items-center justify-between mb-1">
                        <h3 className="font-bold text-lg">Trading Activity</h3>
                        <div className="flex items-center gap-2">
                            <button className="p-1 hover:bg-accent rounded transition-colors" onClick={() => setHeatmapYear((y) => y - 1)}>
                                <ChevronLeft className="h-4 w-4" />
                            </button>
                            <button className="flex items-center gap-2 px-3 py-1 border border-border rounded-lg hover:bg-accent transition-colors" onClick={() => toast(`Viewing ${heatmapYear}`)}>
                                <CalendarIcon className="h-4 w-4" />
                                <span className="text-sm font-medium">{heatmapYear}</span>
                            </button>
                            <button className="p-1 hover:bg-accent rounded transition-colors" onClick={() => setHeatmapYear((y) => y + 1)}>
                                <ChevronRight className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                    <p className="text-sm text-muted-foreground">{totalTrades} trades • {winners} profitable days</p>
                </div>

                {/* Metrics Row */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                    <StatCard
                        label="Total P&L"
                        value={totalPnl !== 0 ? fmt(totalPnl) : '$0.00'}
                        color="primary"
                    />
                    <StatCard
                        label="Win Rate"
                        value={`${winRate}%`}
                    />
                    <StatCard
                        label="Best Day"
                        value={bestDayPnl ? fmt(bestDayPnl) : '$0.00'}
                        changeLabel={bestDayNum ? `${MONTH_LABELS[monthIndex].slice(0, 3)} ${bestDayNum}` : '—'}
                        color="primary"
                    />
                    <StatCard
                        label="Worst Day"
                        value="$0.00"
                        color="danger"
                    />
                </div>

                {/* Year Heatmap Calendar */}
                <div className="space-y-3">
                    <div className="grid grid-cols-12 gap-4">
                        {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((month, mi) => (
                            <div key={month} className="space-y-1">
                                <div className="text-xs text-muted-foreground text-center mb-2">{month}</div>
                                <div className="grid grid-cols-7 gap-0.5">
                                    {Array.from({ length: 35 }).map((_, dayIndex) => {
                                        const isActive = mi === 1 && dayIndex === 5;
                                        const isLoss   = mi === 1 && dayIndex === 19;
                                        return (
                                            <div
                                                key={dayIndex}
                                                className={`
                          h-2 w-2 rounded-sm cursor-pointer transition-colors
                          ${isActive ? 'bg-primary hover:bg-primary/80' : isLoss ? 'bg-destructive/60 hover:bg-destructive/80' : 'bg-accent hover:bg-accent/70'}
                        `}
                                                title={isActive ? 'Feb 6: +$222,704.00' : isLoss ? 'Feb 20: -$3,200.00' : 'No trades'}
                                            />
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Legend */}
                    <div className="flex items-center justify-center gap-4 pt-4 border-t border-border">
                        <span className="text-xs text-muted-foreground">Less</span>
                        <div className="flex items-center gap-1">
                            <div className="h-3 w-3 rounded-sm bg-accent" title="No trades"></div>
                            <div className="h-3 w-3 rounded-sm bg-muted" title="Breakeven"></div>
                            <div className="h-3 w-3 rounded-sm bg-destructive/40" title="Loss"></div>
                            <div className="h-3 w-3 rounded-sm bg-destructive/60" title="Loss"></div>
                            <div className="h-3 w-3 rounded-sm bg-destructive" title="Loss"></div>
                            <div className="h-3 w-3 rounded-sm bg-primary/40" title="Profit"></div>
                            <div className="h-3 w-3 rounded-sm bg-primary/60" title="Profit"></div>
                            <div className="h-3 w-3 rounded-sm bg-primary" title="Profit"></div>
                        </div>
                        <span className="text-xs text-muted-foreground">More</span>
                    </div>
                    <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                            <div className="h-3 w-3 rounded-sm bg-accent"></div>
                            <span>No trades</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="h-3 w-3 rounded-sm bg-muted"></div>
                            <span>Breakeven</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="h-3 w-3 rounded-sm bg-primary"></div>
                            <span>Profit</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="h-3 w-3 rounded-sm bg-destructive"></div>
                            <span>Loss</span>
                        </div>
                    </div>
                </div>
            </Card>

            {/* Trade Calendar */}
            <Card className="p-6">
                <div className="flex items-center justify-between mb-6">
                    <h3 className="font-bold text-lg">Trade Calendar</h3>
                    <div className="flex items-center gap-2">
                        <button className="p-2 hover:bg-accent rounded-lg transition-colors" onClick={() => toast('Calendar settings coming soon')}>
                            <Settings className="h-4 w-4" />
                        </button>
                        <button
                            className="flex items-center gap-2 px-4 py-2 bg-foreground text-background rounded-lg hover:bg-foreground/90 transition-colors"
                            onClick={() => router.push('/portfolios/trade-log')}
                        >
                            <Plus className="h-4 w-4" />
                            <span className="text-sm font-medium">Add Trade</span>
                        </button>
                    </div>
                </div>

                {/* Month Navigation */}
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <button
                            className="p-1 hover:bg-accent rounded transition-colors disabled:opacity-40"
                            disabled={monthIndex === 0}
                            onClick={() => { setMonthIndex((i) => Math.max(0, i - 1)); setSelectedDay(null); }}
                        >
                            <ChevronLeft className="h-5 w-5" />
                        </button>
                        <h4 className="font-bold">{MONTH_LABELS[monthIndex]}</h4>
                        <button
                            className="p-1 hover:bg-accent rounded transition-colors disabled:opacity-40"
                            disabled={monthIndex === MONTH_LABELS.length - 1}
                            onClick={() => { setMonthIndex((i) => Math.min(MONTH_LABELS.length - 1, i + 1)); setSelectedDay(null); }}
                        >
                            <ChevronRight className="h-5 w-5" />
                        </button>
                    </div>
                    <button className="flex items-center gap-2 px-4 py-2 bg-[#fbbf24] text-background rounded-lg hover:bg-[#fbbf24]/90 transition-colors" onClick={() => toast('Share link copied to clipboard')}>
                        <Share2 className="h-4 w-4" />
                        <span className="text-sm font-medium">Share Calendar</span>
                    </button>
                </div>

                {/* Calendar Metrics */}
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
                    <div className="p-4 rounded-lg bg-accent/50 min-w-0">
                        <p className="text-xs text-muted-foreground mb-1">Total Trades</p>
                        <h3 className="text-2xl font-bold truncate">{totalTrades}</h3>
                        <p className="text-xs text-muted-foreground mt-1">{tradingDays} days</p>
                    </div>
                    <div className="p-4 rounded-lg bg-accent/50 min-w-0">
                        <p className="text-xs text-muted-foreground mb-1">Net P&L</p>
                        <h3 className={`text-2xl font-bold truncate ${totalPnl >= 0 ? 'text-primary' : 'text-destructive'}`}>
                            {totalPnl !== 0 ? fmt(totalPnl) : '$0.00'}
                        </h3>
                        <p className="text-xs text-muted-foreground mt-1">{totalPnl >= 0 ? 'Profit' : 'Loss'}</p>
                    </div>
                    <div className="p-4 rounded-lg bg-accent/50 min-w-0">
                        <p className="text-xs text-muted-foreground mb-1">Win Rate</p>
                        <h3 className="text-2xl font-bold truncate">{winRate}%</h3>
                        <p className="text-xs text-muted-foreground mt-1">Success rate</p>
                    </div>
                    <div className="p-4 rounded-lg bg-accent/50 min-w-0">
                        <p className="text-xs text-muted-foreground mb-1">Best Day</p>
                        <h3 className={`text-2xl font-bold truncate ${bestDayPnl >= 0 ? 'text-primary' : 'text-destructive'}`}>
                            {bestDayPnl ? fmt(bestDayPnl) : '$0.00'}
                        </h3>
                        <p className="text-xs text-muted-foreground mt-1">
                            {bestDayNum ? `${MONTH_LABELS[monthIndex].slice(0, 3)} ${String(bestDayNum).padStart(2, '0')}` : '—'}
                        </p>
                    </div>
                    <div className="p-4 rounded-lg bg-accent/50 min-w-0">
                        <p className="text-xs text-muted-foreground mb-1">Profit Factor</p>
                        <h3 className="text-2xl font-bold truncate">&gt; 10.00</h3>
                        <p className="text-xs text-muted-foreground mt-1">Ratio</p>
                    </div>
                </div>

                {/* Calendar Grid with Sidebar */}
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
                    {/* Calendar */}
                    <div>
                        {/* Day Headers */}
                        <div className="grid grid-cols-7 gap-2 mb-2">
                            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                                <div key={day} className="text-center text-sm text-muted-foreground py-2">
                                    {day}
                                </div>
                            ))}
                        </div>

                        {/* Calendar Days */}
                        <div className="grid grid-cols-7 gap-2">
                            {calendarCells.map((day, idx) => {
                                if (day === null) {
                                    return <div key={`blank-${idx}`} className="min-h-[80px]" />;
                                }
                                const trade = monthTrades[day];
                                const isSelected = day === selectedDay;
                                const isToday = monthIndex === 1 && day === 7; // Feb 7 as "today" marker
                                return (
                                    <div
                                        key={`day-${day}`}
                                        onClick={() => setSelectedDay(day === selectedDay ? null : day)}
                                        className={`
                    min-h-[80px] p-3 rounded-lg border transition-colors cursor-pointer
                    ${isSelected ? 'ring-2 ring-primary' : ''}
                    ${trade && trade.pnl > 0 ? 'bg-primary/10 border-primary/30 hover:bg-primary/20' : ''}
                    ${trade && trade.pnl < 0 ? 'bg-destructive/10 border-destructive/30 hover:bg-destructive/20' : ''}
                    ${!trade ? 'bg-card border-border hover:border-primary/40' : ''}
                    ${isToday ? 'border-2 border-foreground' : ''}
                  `}
                                    >
                                        <div className="text-sm font-medium mb-1">{day}</div>
                                        {trade && (
                                            <div className="mt-2">
                                                <div className={`text-xs font-bold truncate ${trade.pnl >= 0 ? 'text-primary' : 'text-destructive'}`}>
                                                    {fmt(trade.pnl)}
                                                </div>
                                                <div className="text-xs text-muted-foreground">{trade.trades} trade{trade.trades !== 1 ? 's' : ''}</div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Sidebar */}
                    <div className="space-y-6">
                        {/* Trade Details */}
                        {selectedTrade ? (
                            <div className="p-4 rounded-lg bg-accent/30 space-y-3">
                                <h4 className="font-bold text-sm">
                                    {MONTH_LABELS[monthIndex].slice(0, 3)} {selectedDay} — Trade Details
                                </h4>
                                <div className="space-y-2">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-muted-foreground">P&L</span>
                                        <span className={`font-bold ${selectedTrade.pnl >= 0 ? 'text-primary' : 'text-destructive'}`}>
                                            {fmt(selectedTrade.pnl)}
                                        </span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-muted-foreground">Trades</span>
                                        <span className="font-medium">{selectedTrade.trades}</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-muted-foreground">Result</span>
                                        <span className={`font-medium ${selectedTrade.pnl >= 0 ? 'text-primary' : 'text-destructive'}`}>
                                            {selectedTrade.pnl >= 0 ? 'Profit' : 'Loss'}
                                        </span>
                                    </div>
                                </div>
                                <button
                                    className="w-full text-center text-xs text-primary hover:underline"
                                    onClick={() => router.push('/portfolios/trade-log')}
                                >
                                    View in Trade Log →
                                </button>
                            </div>
                        ) : (
                            <div className="p-4 rounded-lg bg-accent/30 text-center">
                                <p className="text-sm text-muted-foreground">Select a day to view trade details</p>
                            </div>
                        )}

                        {/* Quick Actions */}
                        <div>
                            <h4 className="font-bold text-sm mb-3">Quick Actions</h4>
                            <div className="space-y-2">
                                <button
                                    className="w-full text-left px-4 py-2 rounded-lg bg-card border border-border hover:border-primary/40 transition-colors"
                                    onClick={() => router.push('/portfolios/trade-log')}
                                >
                                    <span className="text-sm">View All Trades</span>
                                </button>
                                <button
                                    className="w-full text-left px-4 py-2 rounded-lg bg-card border border-border hover:border-primary/40 transition-colors"
                                    onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                                >
                                    <span className="text-sm">Analytics Dashboard</span>
                                </button>
                            </div>
                        </div>

                        {/* Month Highlights */}
                        <div>
                            <h4 className="font-bold text-sm mb-3">Month Highlights</h4>
                            <div className="p-4 rounded-lg bg-card border border-border">
                                {bestDayNum ? (
                                    <div className="flex items-start gap-2 mb-2">
                                        <TrendingUp className="h-4 w-4 text-primary mt-0.5" />
                                        <div className="flex-1">
                                            <p className="text-xs text-muted-foreground">Best Day</p>
                                            <p className={`text-sm font-bold ${bestDayPnl >= 0 ? 'text-primary' : 'text-destructive'}`}>
                                                {fmt(bestDayPnl)}
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                                {MONTH_LABELS[monthIndex].slice(0, 3)} {String(bestDayNum).padStart(2, '0')}
                                            </p>
                                        </div>
                                    </div>
                                ) : (
                                    <p className="text-xs text-muted-foreground text-center">No trades this month</p>
                                )}
                                <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border">
                                    Trade more days to see highlights comparison
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </Card>

            {/* Behavioral Insights Section */}
            <div>
                <h2 className="text-2xl font-bold tracking-tight mb-6">Behavioral Insights</h2>

                {/* Summary Table */}
                <Card className="p-6 mb-6">
                    <h3 className="font-bold text-lg mb-6">Summary</h3>

                    {/* Table */}
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-border">
                                    <th className="text-left py-3 px-4 text-sm text-muted-foreground font-medium">Day</th>
                                    <th className="text-right py-3 px-4 text-sm text-muted-foreground font-medium">Net Profits</th>
                                    <th className="text-center py-3 px-4 text-sm text-muted-foreground font-medium">Winning %</th>
                                    <th className="text-right py-3 px-4 text-sm text-muted-foreground font-medium">Total Profits</th>
                                    <th className="text-right py-3 px-4 text-sm text-muted-foreground font-medium">Total Loss</th>
                                    <th className="text-right py-3 px-4 text-sm text-muted-foreground font-medium">Trades</th>
                                </tr>
                            </thead>
                            <tbody>
                                {[
                                    { day: 'Sunday',    netProfits: '$0.00',      winRate: 0,    totalProfits: '$0.00',      totalLoss: '$0.00', trades: 0 },
                                    { day: 'Monday',    netProfits: '$0.00',      winRate: 0,    totalProfits: '$0.00',      totalLoss: '$0.00', trades: 0 },
                                    { day: 'Tuesday',   netProfits: '$0.00',      winRate: 0,    totalProfits: '$0.00',      totalLoss: '$0.00', trades: 0 },
                                    { day: 'Wednesday', netProfits: '$0.00',      winRate: 0,    totalProfits: '$0.00',      totalLoss: '$0.00', trades: 0 },
                                    { day: 'Thursday',  netProfits: '$0.00',      winRate: 0,    totalProfits: '$0.00',      totalLoss: '$0.00', trades: 0 },
                                    { day: 'Friday',    netProfits: '+$222,704.00', winRate: 66.7, totalProfits: '+$222,704.00', totalLoss: '$3,200.00', trades: 3 },
                                    { day: 'Saturday',  netProfits: '$0.00',      winRate: 0,    totalProfits: '$0.00',      totalLoss: '$0.00', trades: 0 },
                                ].map((row) => (
                                    <tr key={row.day} className="border-b border-border hover:bg-accent/30 transition-colors">
                                        <td className="py-4 px-4 text-sm">{row.day}</td>
                                        <td className="py-4 px-4 text-sm text-right">{row.netProfits}</td>
                                        <td className="py-4 px-4">
                                            {row.winRate > 0 ? (
                                                <div className="flex items-center justify-center gap-2">
                                                    <div className="w-24 h-2 bg-accent rounded-full overflow-hidden">
                                                        <div
                                                            className="h-full bg-gradient-to-r from-destructive via-muted to-primary rounded-full"
                                                            style={{ width: `${row.winRate}%` }}
                                                        />
                                                    </div>
                                                </div>
                                            ) : null}
                                        </td>
                                        <td className="py-4 px-4 text-sm text-right text-primary">{row.totalProfits}</td>
                                        <td className="py-4 px-4 text-sm text-right text-destructive">{row.totalLoss}</td>
                                        <td className="py-4 px-4 text-sm text-right">{row.trades}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Card>

                {/* Trade Distribution */}
                <Card className="p-6 mb-6">
                    <h3 className="font-bold text-lg mb-2">Trade Distribution</h3>
                    <p className="text-sm text-muted-foreground mb-6">Breakdown of your closed trades</p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* Win/Loss Ratio */}
                        <div>
                            <h4 className="text-center font-medium mb-4">Win/Loss Ratio</h4>
                            <ResponsiveContainer width="100%" height={240}>
                                <PieChart>
                                    <Pie
                                        data={[
                                            { name: 'Win', value: 66.7 },
                                            { name: 'Break Even', value: 33.3 }
                                        ]}
                                        cx="50%"
                                        cy="50%"
                                        outerRadius={80}
                                        dataKey="value"
                                        label={({ value }) => `${value}%`}
                                    >
                                        <Cell fill="hsl(142, 76%, 45%)" />
                                        <Cell fill="hsl(0, 72%, 61%)" />
                                    </Pie>
                                </PieChart>
                            </ResponsiveContainer>
                            <div className="flex items-center justify-center gap-4 mt-2">
                                <div className="flex items-center gap-2">
                                    <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'hsl(142, 76%, 45%)' }}></div>
                                    <span className="text-xs text-muted-foreground">Win</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'hsl(0, 72%, 61%)' }}></div>
                                    <span className="text-xs text-muted-foreground">Break Even</span>
                                </div>
                            </div>
                        </div>

                        {/* Trade Types */}
                        <div>
                            <h4 className="text-center font-medium mb-4">Trade Types</h4>
                            <ResponsiveContainer width="100%" height={240}>
                                <PieChart>
                                    <Pie
                                        data={[
                                            { name: 'Long', value: 100 }
                                        ]}
                                        cx="50%"
                                        cy="50%"
                                        outerRadius={80}
                                        dataKey="value"
                                        label={({ value }) => `${value}%`}
                                    >
                                        <Cell fill="hsl(221, 83%, 53%)" />
                                    </Pie>
                                </PieChart>
                            </ResponsiveContainer>
                            <div className="flex items-center justify-center gap-4 mt-2">
                                <div className="flex items-center gap-2">
                                    <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'hsl(221, 83%, 53%)' }}></div>
                                    <span className="text-xs text-muted-foreground">Long</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </Card>

                {/* Trade Distribution by Day of the Week */}
                <Card className="p-6">
                    <h3 className="font-bold text-lg mb-2">Trade Distribution by Day of the Week</h3>
                    <p className="text-sm text-muted-foreground mb-6">See your trading activity patterns throughout the week</p>

                    <ResponsiveContainer width="100%" height={300}>
                        <BarChart
                            layout="vertical"
                            data={[
                                { day: 'Sun', trades: 0 },
                                { day: 'Mon', trades: 0 },
                                { day: 'Tue', trades: 0 },
                                { day: 'Wed', trades: 0 },
                                { day: 'Thu', trades: 0 },
                                { day: 'Fri', trades: totalTrades },
                                { day: 'Sat', trades: 0 },
                            ]}
                            margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                        >
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                            <XAxis type="number" stroke="var(--muted-foreground)" />
                            <YAxis dataKey="day" type="category" stroke="var(--muted-foreground)" />
                            <Tooltip
                                contentStyle={{
                                    backgroundColor: 'var(--card)',
                                    border: '1px solid var(--border)',
                                    borderRadius: '8px'
                                }}
                            />
                            <Bar dataKey="trades" fill="hsl(31, 97%, 56%)" radius={[0, 8, 8, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </Card>
            </div>
        </div>
    );
}
