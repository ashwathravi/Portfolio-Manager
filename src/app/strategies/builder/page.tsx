"use client"

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label"; // Check if Label exists, if not I might need to create it or use simple label
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, ArrowRight, Save, Check, Plus } from "lucide-react";
import Link from "next/link";
import { Textarea } from "@/components/ui/textarea";

const steps = [
    { id: 1, name: "Basics & Universe" },
    { id: 2, name: "Entry Rules" },
    { id: 3, name: "Exit Rules" },
    { id: 4, name: "Execution" },
];

export default function StrategyBuilderPage() {
    const [currentStep, setCurrentStep] = useState(1);
    const progress = (currentStep / steps.length) * 100;

    const nextStep = () => setCurrentStep((prev) => Math.min(prev + 1, steps.length));
    const prevStep = () => setCurrentStep((prev) => Math.max(prev - 1, 1));

    return (
        <div>
            <div className="max-w-3xl mx-auto">
                <div className="mb-8">
                    <div className="flex items-center gap-4 mb-4">
                        <Button variant="ghost" size="icon" asChild aria-label="Back to Strategies">
                            <Link href="/strategies"><ArrowLeft className="h-4 w-4" aria-hidden="true" /></Link>
                        </Button>
                        <div>
                            <h2 className="text-2xl font-bold tracking-tight">Create Strategy</h2>
                            <p className="text-muted-foreground">Define your algorithmic trading strategy.</p>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <div className="flex justify-between text-sm font-medium">
                            <span>Step {currentStep} of {steps.length}: {steps[currentStep - 1].name}</span>
                            <span>{Math.round(progress)}%</span>
                        </div>
                        <Progress value={progress} className="h-2" />
                    </div>
                </div>

                <Card>
                    {currentStep === 1 && (
                        <>
                            <CardHeader>
                                <CardTitle>Strategy Basics</CardTitle>
                                <CardDescription>Name your strategy and define the asset universe.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                <div className="space-y-2">
                                    <Label htmlFor="name">Strategy Name</Label>
                                    <Input id="name" placeholder="e.g. S&P 500 Momentum" />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="description">Description</Label>
                                    <Textarea id="description" placeholder="Describe the logic..." />
                                </div>
                                <div className="space-y-3">
                                    <Label>Universe Type</Label>
                                    <RadioGroup defaultValue="static">
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="static" id="u-static" />
                                            <Label htmlFor="u-static">Static List (Fixed Tickers)</Label>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="dynamic" id="u-dynamic" />
                                            <Label htmlFor="u-dynamic">Dynamic (Screening Rules)</Label>
                                        </div>
                                    </RadioGroup>
                                </div>
                            </CardContent>
                        </>
                    )}

                    {currentStep === 2 && (
                        <>
                            <CardHeader>
                                <CardTitle>Entry Rules</CardTitle>
                                <CardDescription>Define conditions to open a long position.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                <div className="border rounded-md p-4 bg-muted/20">
                                    <p className="text-sm font-medium mb-3">Condition 1</p>
                                    <div className="grid grid-cols-3 gap-4">
                                        <Select defaultValue="rsi">
                                            <SelectTrigger><SelectValue placeholder="Indicator" /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="rsi">RSI (14)</SelectItem>
                                                <SelectItem value="sma">SMA (50)</SelectItem>
                                                <SelectItem value="price">Price</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <Select defaultValue="lt">
                                            <SelectTrigger><SelectValue placeholder="Operator" /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="gt">&gt;</SelectItem>
                                                <SelectItem value="lt">&lt;</SelectItem>
                                                <SelectItem value="cross_above">Crosses Above</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <Input placeholder="Value" defaultValue="30" />
                                    </div>
                                </div>
                                <Button variant="outline" size="sm" className="w-full">
                                    <Plus className="mr-2 h-4 w-4" /> Add Condition
                                </Button>
                            </CardContent>
                        </>
                    )}

                    {currentStep === 3 && (
                        <>
                            <CardHeader>
                                <CardTitle>Exit Rules</CardTitle>
                                <CardDescription>Define conditions to close the position.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                <div className="border rounded-md p-4 bg-muted/20">
                                    <p className="text-sm font-medium mb-3">Condition 1</p>
                                    <div className="grid grid-cols-3 gap-4">
                                        <Select defaultValue="rsi">
                                            <SelectTrigger><SelectValue placeholder="Indicator" /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="rsi">RSI (14)</SelectItem>
                                                <SelectItem value="sma">SMA (50)</SelectItem>
                                                <SelectItem value="price">Price</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <Select defaultValue="gt">
                                            <SelectTrigger><SelectValue placeholder="Operator" /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="gt">&gt;</SelectItem>
                                                <SelectItem value="lt">&lt;</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <Input placeholder="Value" defaultValue="70" />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <div className="flex items-center space-x-2">
                                        <input type="checkbox" id="sl" className="rounded border-gray-300" defaultChecked />
                                        <Label htmlFor="sl">Stop Loss (5%)</Label>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <input type="checkbox" id="tp" className="rounded border-gray-300" defaultChecked />
                                        <Label htmlFor="tp">Take Profit (10%)</Label>
                                    </div>
                                </div>
                            </CardContent>
                        </>
                    )}

                    {currentStep === 4 && (
                        <>
                            <CardHeader>
                                <CardTitle>Execution & Sizing</CardTitle>
                                <CardDescription>Configure position sizing and rebalancing.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                <div className="space-y-3">
                                    <Label>Position Sizing</Label>
                                    <RadioGroup defaultValue="percent">
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="percent" id="s-percent" />
                                            <Label htmlFor="s-percent">% of Equity</Label>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="fixed" id="s-fixed" />
                                            <Label htmlFor="s-fixed">Fixed Amount</Label>
                                        </div>
                                    </RadioGroup>
                                </div>
                                <div className="space-y-2">
                                    <Label>Rebalancing Frequency</Label>
                                    <Select defaultValue="monthly">
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="daily">Daily</SelectItem>
                                            <SelectItem value="weekly">Weekly</SelectItem>
                                            <SelectItem value="monthly">Monthly</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </CardContent>
                        </>
                    )}

                    <CardFooter className="flex justify-between">
                        <Button variant="outline" onClick={prevStep} disabled={currentStep === 1}>
                            Back
                        </Button>
                        {currentStep < steps.length ? (
                            <Button onClick={nextStep}>
                                Next <ArrowRight className="ml-2 h-4 w-4" />
                            </Button>
                        ) : (
                            <Button className="bg-green-600 hover:bg-green-700">
                                <Save className="mr-2 h-4 w-4" /> Save Strategy
                            </Button>
                        )}
                    </CardFooter>
                </Card>
            </div>
        </div>
    );
}

