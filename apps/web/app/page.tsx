import AddUserWrapper from "@/components/AddUserWrapper"
import UsersList from "@/components/UsersList"
import MonthPicker from "@/components/MonthPicker"
import ShiftsSettings from "@/components/ShiftsSettings"
import ExportsButtonWrapper from "@/components/ExportsButtonWrapper"

export default function Page() {
  return (
    <div className="flex min-h-svh flex-col gap-2 p-6">
      <div className="fixed top-0 left-0 p-2 font-mono text-xs text-muted-foreground backdrop-blur-xl">
        (Press <kbd>d</kbd> to toggle dark mode)
      </div>
      <div className={`mt-4 grid w-full grid-cols-4 items-center gap-4`}>
        <div className={`col-span-3 flex w-full items-end justify-start gap-2`}>
          <MonthPicker />
          <ShiftsSettings />
        </div>
        <div className={`flex items-center gap-2`}>
          <AddUserWrapper isPreview={false} />
        </div>
      </div>
      <UsersList />
      <ExportsButtonWrapper />
    </div>
  )
}
