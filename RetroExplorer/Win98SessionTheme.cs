using System.Runtime.InteropServices;

namespace RetroExplorer;

/// <summary>App-scoped Win98 presentation helpers. Does not replace Explorer or mutate system settings.</summary>
internal static class Win98SessionTheme
{
    private const int DwmwaWindowCornerPreference = 33;
    private const int DwmwcpDoNotRound = 1;

    public static void Apply(Form form)
    {
        form.BackColor = Color.FromArgb(192, 192, 192);
        form.Font = new Font("Tahoma", 9F);
        form.HandleCreated += (_, _) => SetSquareCorners(form.Handle);
    }

    private static void SetSquareCorners(IntPtr hwnd)
    {
        if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22000)) return;
        try
        {
            int preference = DwmwcpDoNotRound;
            DwmSetWindowAttribute(hwnd, DwmwaWindowCornerPreference, ref preference, sizeof(int));
        }
        catch (DllNotFoundException) { }
        catch (EntryPointNotFoundException) { }
    }

    [DllImport("dwmapi.dll", PreserveSig = true)]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
}