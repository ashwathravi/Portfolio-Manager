"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function DataManagement() {
    return (
        <Card className="border-red-200 dark:border-red-900">
            <CardHeader>
                <CardTitle className="text-red-600 dark:text-red-400">Danger Zone</CardTitle>
                <CardDescription>
                    Irreversible actions related to your data.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-4 border border-red-100 dark:border-red-900/50 rounded-lg bg-red-50 dark:bg-red-900/20">
                    <div>
                        <h4 className="font-medium text-red-900 dark:text-red-100">Export Usage Data</h4>
                        <p className="text-sm text-red-700 dark:text-red-300">Download a copy of your trading history and performance data.</p>
                    </div>
                    <Button variant="outline" className="border-red-200 hover:bg-red-100 hover:text-red-900 dark:border-red-800 dark:hover:bg-red-900/50 dark:hover:text-red-100">
                        Export Data
                    </Button>
                </div>

                <div className="flex items-center justify-between p-4 border border-red-100 dark:border-red-900/50 rounded-lg bg-red-50 dark:bg-red-900/20">
                    <div>
                        <h4 className="font-medium text-red-900 dark:text-red-100">Delete Account</h4>
                        <p className="text-sm text-red-700 dark:text-red-300">Permanently delete your account and all associated data.</p>
                    </div>
                    <Button variant="destructive">
                        Delete Account
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
