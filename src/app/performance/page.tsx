'use client';

import { StatCard } from '@/components/data-display/StatCard';
import { MetricCard } from '@/components/data-display/MetricCard';
import { Card } from '@/components/ui/card';
import { TrendingUp, Activity, AlertTriangle, Award, Calendar, ChevronDown, Settings, Plus, ChevronLeft, ChevronRight, Share2 } from 'lucide-react';
import {
    mockPerformanceMetrics,
} from '@/lib/mockData';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    AreaChart,
    Area,
    LineChart,
    Line,
} from 'recharts';

export default function PerformancePage() {
    return (
        <div className="space-y-6 p-6">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Performance Analytics</h1>
                <p className="text-muted-foreground">
                    Deep dive into your portfolio performance and risk metrics
                </p>
            </div>

            {/* Analysis Period / Date Filters */}
            <div className="flex items-center gap-4 flex-wrap">
                <button className="flex items-center gap-3 px-6 py-3 rounded-2xl bg-card border border-border hover:border-primary/40 transition-colors shadow-sm">
                    <Calendar className="h-5 w-5" />
                    <span className="font-bold">All Time</span>
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </button>
                <button className="flex items-center gap-3 px-6 py-3 rounded-2xl bg-card border border-border hover:border-primary/40 transition-colors shadow-sm">
                    <Calendar className="h-5 w-5 text-muted-foreground" />
                    <span className="text-muted-foreground">Date Range</span>
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </button>
            </div>

            {/* Trading Performance Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard
                    title="Net Realized P&L"
                    tooltip="Net Realized P&L = Total profits from closed positions minus total losses from closed positions"
                    value="+$1,22,525.00"
                    valueClassName="text-primary"
                    description="2 trades"
                />

                <MetricCard
                    title="Win Rate"
                    tooltip="Win Rate = (Number of winning trades ÷ Total trades) × 100"
                    value="50.0%"
                >
                    <div className="flex items-center gap-2 text-xs">
                        <span className="px-2 py-0.5 rounded-md bg-primary/10 text-primary font-medium">1 win</span>
                        <span className="px-2 py-0.5 rounded-md bg-destructive/10 text-destructive font-medium">1 loss</span>
                    </div>
                    {/* Progress bar */}
                    <div className="mt-3 h-2 bg-accent rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full" style={{ width: '50%' }}></div>
                    </div>
                </MetricCard>

                <MetricCard
                    title="Profit Factor"
                    tooltip="Profit Factor = Gross profit ÷ Gross loss"
                    value={
                        <div className="flex items-center gap-3 mb-2">
                            <div className="relative w-12 h-12">
                                <svg className="w-12 h-12 transform -rotate-90">
                                    <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="4" fill="none" className="text-accent" />
                                    <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="4" fill="none" className="text-primary" strokeDasharray="125.6" strokeDashoffset="31.4" strokeLinecap="round" />
                                </svg>
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <span className="text-xs font-bold">2.2</span>
                                </div>
                            </div>
                            <h3 className="text-2xl font-bold">2.23</h3>
                        </div>
                    }
                    description="Gross P&L: $2.2L / $1L"
                />

                <MetricCard
                    title="Avg win/loss trade"
                    tooltip="Avg Win/Loss Trade = Average gain ÷ |Average loss|"
                    description="Ratio: 2.23"
                >
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <div className="h-8 bg-primary/20 rounded" style={{ width: '80px' }}></div>
                            <span className="text-sm font-bold text-primary">+$2.2k</span>
                        </div>
                    </div>
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <div className="h-8 bg-destructive/20 rounded" style={{ width: '36px' }}></div>
                            <span className="text-sm font-bold text-destructive">-$1.0k</span>
                        </div>
                    </div>
                </MetricCard>
            </div>

            {/* Additional Financial Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard
                    title="Unrealized P&L"
                    tooltip="Unrealized P&L = Current market value of open positions minus their cost basis"
                    value="+$12,450.00"
                    valueClassName="text-primary"
                    description="Open positions"
                />

                <MetricCard
                    title="Available Cash"
                    tooltip="Available Cash = Liquid cash available for new trades or withdrawals"
                    value="$45,230.50"
                    description="Ready to deploy"
                />

                <MetricCard
                    title="Deployed Capital"
                    tooltip="Deployed Capital = Total capital currently invested in open positions"
                    value="$96,820.00"
                    description="68% of total"
                />

                <MetricCard
                    title="Total Open Risk"
                    tooltip="Total Open Risk = Sum of potential losses if all stop losses are hit on open positions"
                    value="$8,420.00"
                    valueClassName="text-destructive"
                    description="8.7% exposure"
                />
            </div>

            {/* Key Performance Metrics */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <StatCard
                    title="Total Return (1Y)"
                    value="+24.67%"
                    changeLabel="vs 18.92% benchmark"
                    icon={<TrendingUp className="h-6 w-6" />}
                    trend="up"
                />
                <StatCard
                    title="Sharpe Ratio"
                    value="1.88"
                    subtitle="Risk-adjusted return"
                    icon={<Activity className="h-6 w-6" />}
                />
                <StatCard
                    title="Max Drawdown"
                    value="-12.34%"
                    subtitle="Largest peak-to-trough"
                    icon={<AlertTriangle className="h-6 w-6" />}
                    trend="down"
                />
                <StatCard
                    title="Alpha"
                    value="+5.75%"
                    subtitle="Excess return"
                    icon={<Award className="h-6 w-6" />}
                    trend="up"
                />
            </div>

            {/* Monthly Performance Bar Chart */}
            <Card className="p-6">
                <div className="mb-6">
                    <h3 className="font-bold text-lg">Monthly Performance</h3>
                    <p className="text-muted-foreground text-sm">Your P&L broken down by month</p>
                </div>
                <ResponsiveContainer width="100%" height={200}>
                    <BarChart
                        data={[
                            { month: 'Jan 25', value: 1850 },
                            { month: 'Feb 25', value: 3420 },
                            { month: 'Mar 25', value: -1100 },
                            { month: 'Apr 25', value: 2780 },
                            { month: 'May 25', value: 4150 },
                            { month: 'Jun 25', value: -680 },
                            { month: 'Jul 25', value: 3900 },
                            { month: 'Aug 25', value: 5210 },
                            { month: 'Sep 25', value: 1630 },
                            { month: 'Oct 25', value: -920 },
                            { month: 'Nov 25', value: 4480 },
                            { month: 'Dec 25', value: 6100 },
                            { month: 'Jan 26', value: 2340 },
                            { month: 'Feb 26', value: 3850 },
                        ]}
                        margin={{ top: 10, right: 10, left: 10, bottom: 20 }}
                    >
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis
                            dataKey="month"
                            tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                            axisLine={{ stroke: 'var(--border)' }}
                            tickLine={false}
                        />
                        <YAxis
                            tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                        />
                        <Tooltip
                            contentStyle={{
                                backgroundColor: 'var(--card)',
                                border: '1px solid var(--border)',
                                borderRadius: '8px',
                            }}
                            labelStyle={{ color: 'var(--foreground)' }}
                            formatter={(value: any) => [`$${Number(value).toLocaleString()}`, 'P&L']}
                        />
                        <Bar
                            dataKey="value"
                            radius={[4, 4, 0, 0]}
                            maxBarSize={60}
                            fill="#17cf54"
                        />
                    </BarChart>
                </ResponsiveContainer>
            </Card>

            {/* Equity Curve Area Chart */}
            <Card className="p-6">
                <div className="mb-6">
                    <h3 className="font-bold text-lg">Equity Curve</h3>
                    <p className="text-muted-foreground text-sm">Your cumulative performance over time with filled gradient</p>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                    <AreaChart
                        data={[
                            { date: 'Jan 25', value: 100000 },
                            { date: 'Feb 25', value: 101850 },
                            { date: 'Mar 25', value: 105270 },
                            { date: 'Apr 25', value: 104170 },
                            { date: 'May 25', value: 106950 },
                            { date: 'Jun 25', value: 111100 },
                            { date: 'Jul 25', value: 110420 },
                            { date: 'Aug 25', value: 114320 },
                            { date: 'Sep 25', value: 119530 },
                            { date: 'Oct 25', value: 121160 },
                            { date: 'Nov 25', value: 120240 },
                            { date: 'Dec 25', value: 124720 },
                            { date: 'Jan 26', value: 131060 },
                            { date: 'Feb 26', value: 133560 },
                            { date: 'Mar 26', value: 137410 },
                        ]}
                        margin={{ top: 10, right: 30, left: 10, bottom: 30 }}
                    >
                        <defs>
                            <linearGradient id="equityCurveGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#17cf54" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#17cf54" stopOpacity={0.05} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis
                            dataKey="date"
                            tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                            axisLine={{ stroke: 'var(--border)' }}
                            tickLine={false}
                            interval={2}
                        />
                        <YAxis
                            tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                            domain={[95000, 145000]}
                        />
                        <Tooltip
                            contentStyle={{
                                backgroundColor: 'var(--card)',
                                border: '1px solid var(--border)',
                                borderRadius: '8px',
                            }}
                            labelStyle={{ color: 'var(--foreground)' }}
                            formatter={(value: any) => [`$${Number(value).toLocaleString()}`, 'Equity']}
                        />
                        <Area
                            type="monotone"
                            dataKey="value"
                            stroke="#17cf54"
                            strokeWidth={2}
                            fill="url(#equityCurveGradient)"
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </Card>

            {/* Account Balance Line Chart */}
            <Card className="p-6">
                <div className="mb-6">
                    <h3 className="font-bold text-lg">Account Balance</h3>
                    <p className="text-muted-foreground text-sm">Capital Deployed and Account Value over time</p>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                    <LineChart
                        data={[
                            { date: 'Jan 25', deployed: 55000, account: 100000 },
                            { date: 'Feb 25', deployed: 58000, account: 101850 },
                            { date: 'Mar 25', deployed: 62000, account: 105270 },
                            { date: 'Apr 25', deployed: 60000, account: 104170 },
                            { date: 'May 25', deployed: 67000, account: 106950 },
                            { date: 'Jun 25', deployed: 72000, account: 111100 },
                            { date: 'Jul 25', deployed: 68000, account: 110420 },
                            { date: 'Aug 25', deployed: 74000, account: 114320 },
                            { date: 'Sep 25', deployed: 80000, account: 119530 },
                            { date: 'Oct 25', deployed: 78000, account: 121160 },
                            { date: 'Nov 25', deployed: 82000, account: 124720 },
                            { date: 'Dec 25', deployed: 88000, account: 131060 },
                            { date: 'Jan 26', deployed: 92000, account: 133560 },
                            { date: 'Feb 26', deployed: 96820, account: 137410 },
                        ]}
                        margin={{ top: 10, right: 30, left: 10, bottom: 30 }}
                    >
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis
                            dataKey="date"
                            tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}
                            axisLine={{ stroke: 'var(--border)' }}
                            tickLine={false}
                            interval={2}
                        />
                        <YAxis
                            tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                            domain={[40000, 150000]}
                        />
                        <Tooltip
                            contentStyle={{
                                backgroundColor: 'var(--card)',
                                border: '1px solid var(--border)',
                                borderRadius: '8px',
                            }}
                            labelStyle={{ color: 'var(--foreground)' }}
                            formatter={(value: any) => [`$${Number(value).toLocaleString()}`, '']}
                        />
                        <Line
                            type="monotone"
                            dataKey="account"
                            stroke="#17cf54"
                            strokeWidth={2}
                            dot={false}
                            name="Account Value"
                        />
                        <Line
                            type="monotone"
                            dataKey="deployed"
                            stroke="#06b6d4"
                            strokeWidth={2}
                            dot={false}
                            strokeDasharray="5 3"
                            name="Deployed Capital"
                        />
                    </LineChart>
                </ResponsiveContainer>
            </Card>

            {/* Trade Analytics Section */}
            <div className="space-y-6">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Trade Analytics</h2>
                    <p className="text-muted-foreground">
                        Detailed breakdown of your trades and execution patterns
                    </p>
                </div>

                {/* Trade Calendar */}
                <Card className="p-6">
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="font-bold text-lg">Trade Calendar</h3>
                        <div className="flex items-center gap-2">
                            <button className="p-2 hover:bg-accent rounded-lg transition-colors">
                                <Settings className="h-4 w-4" />
                            </button>
                            <button className="flex items-center gap-2 px-4 py-2 bg-foreground text-background rounded-lg hover:bg-foreground/90 transition-colors">
                                <Plus className="h-4 w-4" />
                                <span className="text-sm font-medium">Add Trade</span>
                            </button>
                        </div>
                    </div>

                    {/* Month Navigation */}
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                            <button className="p-1 hover:bg-accent rounded transition-colors">
                                <ChevronLeft className="h-5 w-5" />
                            </button>
                            <h4 className="font-bold">February 2026</h4>
                            <button className="p-1 hover:bg-accent rounded transition-colors">
                                <ChevronRight className="h-5 w-5" />
                            </button>
                        </div>
                        <button className="flex items-center gap-2 px-4 py-2 bg-[#fbbf24] text-background rounded-lg hover:bg-[#fbbf24]/90 transition-colors">
                            <Share2 className="h-4 w-4" />
                            <span className="text-sm font-medium">Share Calendar</span>
                        </button>
                    </div>

                    {/* Calendar Metrics */}
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
                        <div className="p-4 rounded-lg bg-accent/50 min-w-0">
                            <p className="text-xs text-muted-foreground mb-1">Total Trades</p>
                            <h3 className="text-2xl font-bold truncate">3</h3>
                            <p className="text-xs text-muted-foreground mt-1">7 days</p>
                        </div>
                        <div className="p-4 rounded-lg bg-accent/50 min-w-0">
                            <p className="text-xs text-muted-foreground mb-1">Net P&L</p>
                            <h3 className="text-2xl font-bold text-primary truncate">+$222,704.00</h3>
                            <p className="text-xs text-muted-foreground mt-1">Profit</p>
                        </div>
                        <div className="p-4 rounded-lg bg-accent/50 min-w-0">
                            <p className="text-xs text-muted-foreground mb-1">Win Rate</p>
                            <h3 className="text-2xl font-bold truncate">66.7%</h3>
                            <p className="text-xs text-muted-foreground mt-1">Success rate</p>
                        </div>
                        <div className="p-4 rounded-lg bg-accent/50 min-w-0">
                            <p className="text-xs text-muted-foreground mb-1">Best Day</p>
                            <h3 className="text-2xl font-bold text-primary truncate">+$222,704.00</h3>
                            <p className="text-xs text-muted-foreground mt-1">Feb 06</p>
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
                                {/* Week 1 */}
                                {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                                    <div
                                        key={`week1-${day}`}
                                        className={`
                      min-h-[80px] p-3 rounded-lg border transition-colors
                      ${day === 6 ? 'bg-primary/10 border-primary/30' : 'bg-card border-border hover:border-primary/40'}
                      ${day === 7 ? 'border-2 border-foreground' : ''}
                      cursor-pointer
                    `}
                                    >
                                        <div className="text-sm font-medium mb-1">{day}</div>
                                        {day === 6 && (
                                            <div className="mt-2">
                                                <div className="text-xs font-bold text-primary truncate">+$222,704.00</div>
                                            </div>
                                        )}
                                    </div>
                                ))}

                                {/* Week 2 */}
                                {[8, 9, 10, 11, 12, 13, 14].map((day) => (
                                    <div
                                        key={`week2-${day}`}
                                        className="min-h-[80px] p-3 rounded-lg border bg-card border-border hover:border-primary/40 transition-colors cursor-pointer"
                                    >
                                        <div className="text-sm font-medium">{day}</div>
                                    </div>
                                ))}

                                {/* Week 3 */}
                                {[15, 16, 17, 18, 19, 20, 21].map((day) => (
                                    <div
                                        key={`week3-${day}`}
                                        className="min-h-[80px] p-3 rounded-lg border bg-card border-border hover:border-primary/40 transition-colors cursor-pointer"
                                    >
                                        <div className="text-sm font-medium">{day}</div>
                                    </div>
                                ))}

                                {/* Week 4 */}
                                {[22, 23, 24, 25, 26, 27, 28].map((day) => (
                                    <div
                                        key={`week4-${day}`}
                                        className="min-h-[80px] p-3 rounded-lg border bg-card border-border hover:border-primary/40 transition-colors cursor-pointer"
                                    >
                                        <div className="text-sm font-medium">{day}</div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Sidebar */}
                        <div className="space-y-6">
                            {/* Trade Details */}
                            <div className="p-4 rounded-lg bg-accent/30 text-center">
                                <p className="text-sm text-muted-foreground">Select a day to view trade details</p>
                            </div>

                            {/* Quick Actions */}
                            <div>
                                <h4 className="font-bold text-sm mb-3">Quick Actions</h4>
                                <div className="space-y-2">
                                    <button className="w-full text-left px-4 py-2 rounded-lg bg-card border border-border hover:border-primary/40 transition-colors">
                                        <span className="text-sm">View All Trades</span>
                                    </button>
                                    <button className="w-full text-left px-4 py-2 rounded-lg bg-card border border-border hover:border-primary/40 transition-colors">
                                        <span className="text-sm">Analytics Dashboard</span>
                                    </button>
                                </div>
                            </div>

                            {/* Month Highlights */}
                            <div>
                                <h4 className="font-bold text-sm mb-3">Month Highlights</h4>
                                <div className="p-4 rounded-lg bg-card border border-border">
                                    <div className="flex items-start gap-2 mb-2">
                                        <TrendingUp className="h-4 w-4 text-primary mt-0.5" />
                                        <div className="flex-1">
                                            <p className="text-xs text-muted-foreground">Best Day</p>
                                            <p className="text-sm font-bold text-primary">$222,704.00</p>
                                            <p className="text-xs text-muted-foreground">Feb 06</p>
                                        </div>
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border">
                                        Trade more days to see highlights comparison
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </Card>
            </div>

            {/* Performance Table */}
            <Card className="p-6">
                <h3 className="mb-4 font-semibold">Performance by Period</h3>
                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Period</TableHead>
                                <TableHead className="text-right">Return</TableHead>
                                <TableHead className="text-right">Benchmark</TableHead>
                                <TableHead className="text-right">Alpha</TableHead>
                                <TableHead className="text-right">Sharpe Ratio</TableHead>
                                <TableHead className="text-right">Max Drawdown</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {mockPerformanceMetrics.map((metric) => (
                                <TableRow key={metric.period}>
                                    <TableCell className="font-medium">{metric.period}</TableCell>
                                    <TableCell className="text-right text-green-600">
                                        {metric.return > 0 ? '+' : ''}{metric.return.toFixed(2)}%
                                    </TableCell>
                                    <TableCell className="text-right text-muted-foreground">
                                        {metric.benchmark > 0 ? '+' : ''}{metric.benchmark.toFixed(2)}%
                                    </TableCell>
                                    <TableCell className="text-right text-green-600">
                                        {metric.alpha > 0 ? '+' : ''}{metric.alpha.toFixed(2)}%
                                    </TableCell>
                                    <TableCell className="text-right">{metric.sharpe.toFixed(2)}</TableCell>
                                    <TableCell className="text-right text-red-600">
                                        {metric.maxDrawdown.toFixed(2)}%
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </Card>

            {/* Risk Metrics */}
            <div className="grid gap-4 md:grid-cols-2">
                <Card className="p-6">
                    <h3 className="mb-4 font-semibold">Risk Metrics</h3>
                    <div className="space-y-3">
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Volatility (Annual)</span>
                            <span className="font-medium">14.32%</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Beta</span>
                            <span className="font-medium">1.08</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Value at Risk (95%)</span>
                            <span className="font-medium text-red-600">-$12,450</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Sortino Ratio</span>
                            <span className="font-medium">2.14</span>
                        </div>
                    </div>
                </Card>

                <Card className="p-6">
                    <h3 className="mb-4 font-semibold">Attribution Analysis</h3>
                    <div className="space-y-3">
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Stock Selection</span>
                            <span className="font-medium text-green-600">+3.42%</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Asset Allocation</span>
                            <span className="font-medium text-green-600">+1.89%</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Timing</span>
                            <span className="font-medium">+0.44%</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Interaction Effect</span>
                            <span className="font-medium">-0.12%</span>
                        </div>
                    </div>
                </Card>
            </div>
        </div>
    );
}
