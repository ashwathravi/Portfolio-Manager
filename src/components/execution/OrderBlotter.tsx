"use client"

import {
    ColumnDef,
    flexRender,
    getCoreRowModel,
    useReactTable,
} from "@tanstack/react-table"

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Order } from "@/types/execution"
import { Badge } from "@/components/ui/badge"
import { X } from "lucide-react"

interface OrderBlotterProps {
    orders: Order[]
    onCancel?: (id: string) => void
}

function makeColumns(onCancel?: (id: string) => void): ColumnDef<Order>[] {
    const cols: ColumnDef<Order>[] = [
        {
            accessorKey: "placedAt",
            header: "Time",
            cell: ({ row }) => {
                const date = row.getValue("placedAt") as Date
                return date.toLocaleTimeString()
            },
        },
        {
            accessorKey: "ticker",
            header: "Ticker",
            cell: ({ row }) => <span className="font-semibold">{row.getValue("ticker")}</span>,
        },
        {
            accessorKey: "side",
            header: "Side",
            cell: ({ row }) => {
                const side = row.getValue("side") as string
                return (
                    <span className={side === "buy" ? "text-primary font-medium" : "text-destructive font-medium"}>
                        {side.toUpperCase()}
                    </span>
                )
            },
        },
        {
            accessorKey: "type",
            header: "Type",
            cell: ({ row }) => <span className="uppercase">{row.getValue("type")}</span>,
        },
        {
            accessorKey: "quantity",
            header: "Qty",
        },
        {
            accessorKey: "limitPrice",
            header: "Price",
            cell: ({ row }) => {
                const price = row.getValue("limitPrice") as number
                return price ? `$${price.toFixed(2)}` : "MKT"
            },
        },
        {
            accessorKey: "status",
            header: "Status",
            cell: ({ row }) => {
                const status = row.getValue("status") as string
                let variant: "default" | "secondary" | "destructive" | "outline" = "outline"
                if (status === "filled") variant = "default"
                if (status === "cancelled") variant = "secondary"
                if (status === "rejected") variant = "destructive"

                return (
                    <Badge variant={variant} className="uppercase">
                        {status}
                    </Badge>
                )
            },
        },
    ]

    if (onCancel) {
        cols.push({
            id: "actions",
            header: "",
            cell: ({ row }) => {
                if (row.original.status !== "working") return null
                return (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => onCancel(row.original.id)}
                        aria-label={`Cancel order for ${row.original.ticker}`}
                    >
                        <X className="h-4 w-4" />
                    </Button>
                )
            },
        })
    }

    return cols
}

export function OrderBlotter({ orders, onCancel }: OrderBlotterProps) {
    const columns = makeColumns(onCancel)

    const table = useReactTable({
        data: orders,
        columns,
        getCoreRowModel: getCoreRowModel(),
    })

    return (
        <div className="rounded-md border">
            <Table>
                <TableHeader>
                    {table.getHeaderGroups().map((headerGroup) => (
                        <TableRow key={headerGroup.id}>
                            {headerGroup.headers.map((header) => (
                                <TableHead key={header.id}>
                                    {header.isPlaceholder
                                        ? null
                                        : flexRender(header.column.columnDef.header, header.getContext())}
                                </TableHead>
                            ))}
                        </TableRow>
                    ))}
                </TableHeader>
                <TableBody>
                    {table.getRowModel().rows?.length ? (
                        table.getRowModel().rows.map((row) => (
                            <TableRow key={row.id} data-state={row.getIsSelected() && "selected"}>
                                {row.getVisibleCells().map((cell) => (
                                    <TableCell key={cell.id}>
                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                    </TableCell>
                                ))}
                            </TableRow>
                        ))
                    ) : (
                        <TableRow>
                            <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                                No orders.
                            </TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>
        </div>
    )
}
