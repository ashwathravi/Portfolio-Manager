"use client"

import { ColumnDef } from "@tanstack/react-table"
import { ArrowUpDown, MoreHorizontal } from "lucide-react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Portfolio } from "@/types/portfolio"
import { PerformanceBadge } from "@/components/data-display/PerformanceBadge"

export const columns: ColumnDef<Portfolio>[] = [
    {
        accessorKey: "name",
        header: ({ column }) => {
            return (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Name
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            )
        },
        cell: ({ row }) => (
            <div className="font-medium">
                <Link href={`/portfolios/${row.original.id}`} className="hover:underline">
                    {row.getValue("name")}
                </Link>
            </div>
        ),
    },
    {
        accessorKey: "totalValue",
        header: ({ column: _column }) => (
            <div className="text-right">
                <Button
                    variant="ghost"
                    onClick={() => _column.toggleSorting(_column.getIsSorted() === "asc")}
                >
                    Value
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            </div>
        ),
        cell: ({ row }) => {
            const amount = parseFloat(row.getValue("totalValue"))
            const formatted = new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: "USD",
            }).format(amount)

            return <div className="text-right font-medium">{formatted}</div>
        },
    },
    {
        accessorKey: "dayChangePercent",
        header: "Day Change",
        cell: ({ row }) => {
            const val = parseFloat(row.getValue("dayChangePercent"))
            return <PerformanceBadge value={val} size="sm" />
        },
    },
    {
        accessorKey: "unrealizedGainPercent",
        header: "Total Return",
        cell: ({ row }) => {
            const val = parseFloat(row.getValue("unrealizedGainPercent"))
            return <PerformanceBadge value={val} size="sm" />
        },
    },
    {
        accessorKey: "cashBalance",
        header: () => <div className="text-right">Cash Balance</div>,
        cell: ({ row }) => {
            const amount = parseFloat(row.getValue("cashBalance"))
            const formatted = new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: "USD",
            }).format(amount)
            return <div className="text-right text-muted-foreground">{formatted}</div>
        },
    },
    {
        accessorKey: "updatedAt",
        header: "Last Updated",
        cell: ({ row }) => {
            return (
                <div className="text-muted-foreground text-xs">
                    {new Date(row.getValue("updatedAt")).toLocaleDateString()}
                </div>
            )
        }
    },
    {
        id: "actions",
        cell: ({ row }) => {
            const portfolio = row.original

            return (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0">
                            <span className="sr-only">Open menu</span>
                            <MoreHorizontal className="h-4 w-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuItem
                            onClick={() => navigator.clipboard.writeText(portfolio.id)}
                        >
                            Copy ID
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem asChild>
                            <Link href={`/portfolios/${portfolio.id}`}>View Details</Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem>Edit Settings</DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            )
        },
    },
]
