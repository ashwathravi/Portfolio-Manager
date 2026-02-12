"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Wallet, Globe, ArrowRightLeft } from "lucide-react";

interface Integration {
    id: string;
    name: string;
    description: string;
    icon: React.ReactNode;
    status: "connected" | "disconnected";
    lastSync?: string;
}

const initialIntegrations: Integration[] = [
    {
        id: "ibkr",
        name: "Interactive Brokers",
        description: "Portfolio sync and trade execution",
        icon: <ArrowRightLeft className="h-6 w-6" />,
        status: "connected",
        lastSync: "2 mins ago",
    },
    {
        id: "schwab",
        name: "Charles Schwab",
        description: "Portfolio sync only",
        icon: <Globe className="h-6 w-6" />,
        status: "disconnected",
    },
    {
        id: "coinbase",
        name: "Coinbase",
        description: "Crypto assets tracking",
        icon: <Wallet className="h-6 w-6" />,
        status: "connected",
        lastSync: "1 hour ago",
    },
];

export function IntegrationsList() {
    const [integrations, setIntegrations] = useState(initialIntegrations);

    const handleToggle = (id: string) => {
        setIntegrations(prev => prev.map(item => {
            if (item.id === id) {
                return { ...item, status: item.status === "connected" ? "disconnected" : "connected" };
            }
            return item;
        }));
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Connected Accounts</CardTitle>
                <CardDescription>
                    Manage your connections to brokerage accounts and data providers.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {integrations.map((item) => (
                    <div key={item.id} className="flex items-center justify-between p-4 border rounded-lg">
                        <div className="flex items-center space-x-4">
                            <div className="p-2 bg-muted rounded-full">
                                {item.icon}
                            </div>
                            <div>
                                <h4 className="font-medium">{item.name}</h4>
                                <p className="text-sm text-muted-foreground">{item.description}</p>
                            </div>
                        </div>
                        <div className="flex items-center space-x-4">
                            {item.status === "connected" && (
                                <Badge variant="secondary" className="bg-green-100 text-green-800 hover:bg-green-100">
                                    Connected
                                </Badge>
                            )}
                            <Button
                                variant={item.status === "connected" ? "outline" : "default"}
                                onClick={() => handleToggle(item.id)}
                            >
                                {item.status === "connected" ? "Disconnect" : "Connect"}
                            </Button>
                        </div>
                    </div>
                ))}
            </CardContent>
        </Card>
    );
}
