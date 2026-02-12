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
import { Order } from "@/types/execution"
import { Badge } from "@/components/ui/badge"

interface OrderBlotterProps {
    orders: Order[]
}

export const columns: ColumnDef<Order>[] = [
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
                <span className={side === 'buy' ? 'text-success-600 font-medium' : 'text-danger-600 font-medium'}>
                    {side.toUpperCase()}
                </span>
            )
        }
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
            return price ? `$${price.toFixed(2)}` : 'MKT'
        }
    },
    {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
            const status = row.getValue("status") as string
            let variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" = "outline"
            if (status === 'filled') variant = 'success'
            if (status === 'working') variant = 'warning'
            if (status === 'cancelled') variant = 'secondary'

            return <Badge variant={variant} className="uppercase">{status}</Badge>
        }
    },
]

export function OrderBlotter({ orders }: OrderBlotterProps) {
    // eslint-disable-next-line react-hooks/incompatible-library
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
                            {headerGroup.headers.map((header) => {
                                return (
                                    <TableHead key={header.id}>
                                        {header.isPlaceholder
                                            ? null
                                            : flexRender(
                                                header.column.columnDef.header,
                                                header.getContext()
                                            )}
                                    </TableHead>
                                )
                            })}
                        </TableRow>
                    ))}
                </TableHeader>
                <TableBody>
                    {table.getRowModel().rows?.length ? (
                        table.getRowModel().rows.map((row) => (
                            <TableRow
                                key={row.id}
                                data-state={row.getIsSelected() && "selected"}
                            >
                                {row.getVisibleCells().map((cell) => (
                                    <TableCell key={cell.id}>
                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                    </TableCell>
                                ))}
                            </TableRow>
                        ))
                    ) : (
                        <TableRow>
                            <TableCell colSpan={columns.length} className="h-24 text-center">
                                No active orders.
                            </TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>
        </div>
    )
}
