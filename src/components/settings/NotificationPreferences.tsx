"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function NotificationPreferences() {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Notifications</CardTitle>
                <CardDescription>
                    Configure how you receive alerts and reports.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="space-y-4">
                    <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Email Notifications</h3>
                    <div className="flex items-center justify-between space-x-2">
                        <Label htmlFor="daily-digest" className="flex flex-col space-y-1">
                            <span>Daily Digest</span>
                            <span className="font-normal text-xs text-muted-foreground">Receive a summary of your portfolio performance every morning.</span>
                        </Label>
                        <Switch id="daily-digest" defaultChecked />
                    </div>
                    <div className="flex items-center justify-between space-x-2">
                        <Label htmlFor="weekly-report" className="flex flex-col space-y-1">
                            <span>Weekly Report</span>
                            <span className="font-normal text-xs text-muted-foreground">Detailed weekly analysis and insights.</span>
                        </Label>
                        <Switch id="weekly-report" defaultChecked />
                    </div>
                    <div className="flex items-center justify-between space-x-2">
                        <Label htmlFor="trade-confirmations" className="flex flex-col space-y-1">
                            <span>Trade Confirmations</span>
                            <span className="font-normal text-xs text-muted-foreground">Receive emails when orders are executed.</span>
                        </Label>
                        <Switch id="trade-confirmations" defaultChecked />
                    </div>
                </div>

                <div className="space-y-4">
                    <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Real-time Alerts</h3>
                    <div className="flex items-center justify-between space-x-2">
                        <Label htmlFor="price-alerts" className="flex flex-col space-y-1">
                            <span>Price Alerts</span>
                            <span className="font-normal text-xs text-muted-foreground">Push notifications for custom price targets.</span>
                        </Label>
                        <Switch id="price-alerts" defaultChecked />
                    </div>
                    <div className="flex items-center justify-between space-x-2">
                        <Label htmlFor="risk-alerts" className="flex flex-col space-y-1">
                            <span>Risk Alerts</span>
                            <span className="font-normal text-xs text-muted-foreground">Notify when portfolio risk exceeds defined limits.</span>
                        </Label>
                        <Switch id="risk-alerts" defaultChecked />
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
