'use client';

import { Card } from '@/components/ui/card';
import { Settings, Plus, ChevronLeft, ChevronRight, Share2, TrendingUp, Calendar as CalendarIcon } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';

export default function TradeAnalyticsPage() {
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
                            <button className="p-1 hover:bg-accent rounded transition-colors">
                                <ChevronLeft className="h-4 w-4" />
                            </button>
                            <button className="flex items-center gap-2 px-3 py-1 border border-border rounded-lg hover:bg-accent transition-colors">
                                <CalendarIcon className="h-4 w-4" />
                                <span className="text-sm font-medium">2026</span>
                            </button>
                            <button className="p-1 hover:bg-accent rounded transition-colors">
                                <ChevronRight className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                    <p className="text-sm text-muted-foreground">2 trades • 1 profitable days</p>
                </div>

                {/* Metrics Row */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                    <div className="p-4 rounded-lg border border-border bg-card">
                        <p className="text-xs text-muted-foreground mb-1">Total P&L</p>
                        <h3 className="text-2xl font-bold text-primary">$2,22,525.00</h3>
                    </div>
                    <div className="p-4 rounded-lg border border-border bg-card">
                        <p className="text-xs text-muted-foreground mb-1">Win Rate</p>
                        <h3 className="text-2xl font-bold">100.0%</h3>
                    </div>
                    <div className="p-4 rounded-lg border border-border bg-card">
                        <p className="text-xs text-muted-foreground mb-1">Best Day</p>
                        <h3 className="text-2xl font-bold text-primary">$2,22,525.00</h3>
                        <p className="text-xs text-muted-foreground mt-1">Feb 6</p>
                    </div>
                    <div className="p-4 rounded-lg border border-border bg-card">
                        <p className="text-xs text-muted-foreground mb-1">Worst Day</p>
                        <h3 className="text-2xl font-bold text-destructive">$0.00</h3>
                    </div>
                </div>

                {/* Year Heatmap Calendar */}
                <div className="space-y-3">
                    <div className="grid grid-cols-12 gap-4">
                        {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((month, monthIndex) => (
                            <div key={month} className="space-y-1">
                                <div className="text-xs text-muted-foreground text-center mb-2">{month}</div>
                                <div className="grid grid-cols-7 gap-0.5">
                                    {Array.from({ length: 35 }).map((_, dayIndex) => {
                                        // Show green on Feb 6th (month 1, around day 5-6)
                                        const isActive = monthIndex === 1 && dayIndex === 5;
                                        return (
                                            <div
                                                key={dayIndex}
                                                className={`
                          h-2 w-2 rounded-sm cursor-pointer transition-colors
                          ${isActive ? 'bg-primary hover:bg-primary/80' : 'bg-accent hover:bg-accent/70'}
                        `}
                                                title={isActive ? 'Feb 6: $2,22,525.00' : 'No trades'}
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
                    <div className="p-4 rounded-lg bg-accent/50">
                        <p className="text-xs text-muted-foreground mb-1">Total Trades</p>
                        <h3 className="text-2xl font-bold">3</h3>
                        <p className="text-xs text-muted-foreground mt-1">7 days</p>
                    </div>
                    <div className="p-4 rounded-lg bg-accent/50">
                        <p className="text-xs text-muted-foreground mb-1">Net P&L</p>
                        <h3 className="text-2xl font-bold text-primary">+$2,22,704.00</h3>
                        <p className="text-xs text-muted-foreground mt-1">Profit</p>
                    </div>
                    <div className="p-4 rounded-lg bg-accent/50">
                        <p className="text-xs text-muted-foreground mb-1">Win Rate</p>
                        <h3 className="text-2xl font-bold">66.7%</h3>
                        <p className="text-xs text-muted-foreground mt-1">Success rate</p>
                    </div>
                    <div className="p-4 rounded-lg bg-accent/50">
                        <p className="text-xs text-muted-foreground mb-1">Best Day</p>
                        <h3 className="text-2xl font-bold text-primary">+$2,22,704.00</h3>
                        <p className="text-xs text-muted-foreground mt-1">Feb 06</p>
                    </div>
                    <div className="p-4 rounded-lg bg-accent/50">
                        <p className="text-xs text-muted-foreground mb-1">Profit Factor</p>
                        <h3 className="text-2xl font-bold">&gt; 10.00</h3>
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
                                            <div className="text-xs font-bold text-primary">+$2,22,704.00</div>
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
                                        <p className="text-sm font-bold text-primary">$2,22,704.00</p>
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

            {/* Additional Trade Analytics sections can be added here */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="p-6">
                    <div className="mb-4">
                        <h3 className="font-bold text-lg">Trade Distribution</h3>
                        <p className="text-muted-foreground text-sm">Analysis of your trading patterns</p>
                    </div>
                    <div className="space-y-4">
                        <div className="flex items-center justify-between p-4 rounded-lg bg-accent/30">
                            <span className="text-sm text-muted-foreground">Coming soon</span>
                        </div>
                    </div>
                </Card>

                <Card className="p-6">
                    <div className="mb-4">
                        <h3 className="font-bold text-lg">Win/Loss Analysis</h3>
                        <p className="text-muted-foreground text-sm">Detailed breakdown of outcomes</p>
                    </div>
                    <div className="space-y-4">
                        <div className="flex items-center justify-between p-4 rounded-lg bg-accent/30">
                            <span className="text-sm text-muted-foreground">Coming soon</span>
                        </div>
                    </div>
                </Card>
            </div>

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
                                    { day: 'Sunday', netProfits: '$0.00', winRate: 0, totalProfits: '$0.00', totalLoss: '$0.00', trades: 0 },
                                    { day: 'Monday', netProfits: '$0.00', winRate: 0, totalProfits: '$0.00', totalLoss: '$0.00', trades: 0 },
                                    { day: 'Tuesday', netProfits: '$0.00', winRate: 0, totalProfits: '$0.00', totalLoss: '$0.00', trades: 0 },
                                    { day: 'Wednesday', netProfits: '$0.00', winRate: 0, totalProfits: '$0.00', totalLoss: '$0.00', trades: 0 },
                                    { day: 'Thursday', netProfits: '$0.00', winRate: 0, totalProfits: '$0.00', totalLoss: '$0.00', trades: 0 },
                                    { day: 'Friday', netProfits: '$2,22,525.00', winRate: 66.7, totalProfits: '$2,22,525.00', totalLoss: '$0.00', trades: 2 },
                                    { day: 'Saturday', netProfits: '$0.00', winRate: 0, totalProfits: '$0.00', totalLoss: '$0.00', trades: 0 },
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
                                { day: 'Fri', trades: 2 },
                                { day: 'Sat', trades: 0 },
                            ]}
                            margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                        >
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                            <XAxis type="number" stroke="hsl(var(--muted-foreground))" />
                            <YAxis dataKey="day" type="category" stroke="hsl(var(--muted-foreground))" />
                            <Tooltip
                                contentStyle={{
                                    backgroundColor: 'hsl(var(--card))',
                                    border: '1px solid hsl(var(--border))',
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
