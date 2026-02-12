import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Thesis } from "@/types/research";
import { Clock, TrendingUp, Target } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

interface ThesisCardProps {
    thesis: Thesis;
}

export function ThesisCard({ thesis }: ThesisCardProps) {
    const getStatusColor = (status: Thesis['status']) => {
        switch (status) {
            case 'active': return 'default';
            case 'tested': return 'success';
            case 'abandoned': return 'destructive';
            case 'archived': return 'secondary';
            default: return 'outline';
        }
    };

    return (
        <Card className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
                <div className="flex justify-between items-start">
                    <div>
                        <CardTitle className="text-lg font-bold">
                            <Link href={`/research/theses/${thesis.id}`} className="hover:underline">
                                {thesis.ticker}
                            </Link>
                        </CardTitle>
                        <CardDescription className="text-sm font-medium mt-1">
                            {thesis.securityName}
                        </CardDescription>
                    </div>
                    <Badge variant={getStatusColor(thesis.status)} className="capitalize">
                        {thesis.status}
                    </Badge>
                </div>
            </CardHeader>
            <CardContent className="pb-4">
                <h4 className="font-semibold text-sm mb-1">{thesis.title}</h4>
                <p className="text-sm text-muted-foreground line-clamp-3">
                    {thesis.hypothesis}
                </p>

                <div className="mt-4 flex flex-wrap gap-2 text-xs">
                    <Badge variant="outline" className="flex items-center gap-1">
                        <TrendingUp className="size-3" />
                        {thesis.conviction.toUpperCase()} CONVICTION
                    </Badge>
                    <Badge variant="outline" className="flex items-center gap-1">
                        <Clock className="size-3" />
                        {thesis.timeHorizon}
                    </Badge>
                    <Badge variant="outline" className="flex items-center gap-1">
                        <Target className="size-3" />
                        Target: ${thesis.priceTargets.base}
                    </Badge>
                </div>
            </CardContent>
            <CardFooter className="pt-0 flex justify-between items-center text-xs text-muted-foreground">
                <span>Updated: {new Date(thesis.updatedAt).toLocaleDateString()}</span>
                <Button size="sm" variant="ghost" asChild>
                    <Link href={`/research/theses/${thesis.id}`}>View Analysis</Link>
                </Button>
            </CardFooter>
        </Card>
    );
}
