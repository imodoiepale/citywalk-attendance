import Image from 'next/image'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <Image src="/logo-mark.png" alt="Citywalk" width={40} height={40} className="rounded-lg" priority />
          <span className="bg-gradient-to-r from-[#AB8704] to-[#FDEC06] bg-clip-text text-lg font-semibold text-transparent">
            Citywalk Attendance
          </span>
        </div>
        {children}
      </div>
    </div>
  )
}
