"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function ProfileForm() {
    const [isLoading, setIsLoading] = useState(false);

    const handleSave = async () => {
        setIsLoading(true);
        // Simulate API call
        await new Promise(resolve => setTimeout(resolve, 1000));
        setIsLoading(false);
    };

    return (
        <Card className="border-border shadow-sm">
            <CardHeader className="pb-4">
                <CardTitle className="text-xl">Profile Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="space-y-2">
                    <Label htmlFor="fullName" className="text-base font-normal text-muted-foreground">Full Name</Label>
                    <div className="bg-muted/50 p-1 rounded-md">
                        <Input
                            id="fullName"
                            defaultValue="John Doe"
                            className="border-0 bg-transparent shadow-none focus-visible:ring-0 h-10"
                        />
                    </div>
                </div>

                <div className="space-y-2">
                    <Label htmlFor="email" className="text-base font-normal text-muted-foreground">Email</Label>
                    <div className="bg-muted/50 p-1 rounded-md">
                        <Input
                            id="email"
                            type="email"
                            defaultValue="john@example.com"
                            className="border-0 bg-transparent shadow-none focus-visible:ring-0 h-10"
                        />
                    </div>
                </div>

                <div className="space-y-2">
                    <Label htmlFor="phone" className="text-base font-normal text-muted-foreground">Phone Number</Label>
                    <div className="bg-muted/50 p-1 rounded-md">
                        <Input
                            id="phone"
                            defaultValue="+1 (555) 123-4567"
                            className="border-0 bg-transparent shadow-none focus-visible:ring-0 h-10"
                        />
                    </div>
                </div>
            </CardContent>
            <CardFooter className="pt-2 pb-6">
                <Button
                    onClick={handleSave}
                    disabled={isLoading}
                    className="bg-emerald-500 hover:bg-emerald-600 text-white font-medium px-6 py-2 h-auto"
                >
                    {isLoading ? "Saving..." : "Save Changes"}
                </Button>
            </CardFooter>
        </Card>
    );
}
