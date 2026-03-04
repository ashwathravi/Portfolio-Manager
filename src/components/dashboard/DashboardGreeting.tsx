'use client'

import { useSettingsStore } from '@/lib/stores/settingsStore'

interface DashboardGreetingProps {
    greeting: string
}

export function DashboardGreeting({ greeting }: DashboardGreetingProps) {
    const fullName = useSettingsStore((s) => s.profile.fullName)
    const firstName = fullName.split(' ')[0] || fullName

    return <h1 className="text-3xl md:text-4xl font-black tracking-tight">Good {greeting}, {firstName}</h1>
}
