using System.Drawing.Drawing2D;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;

namespace RetroExplorer;

/// <summary>App-scoped Win98 presentation helpers: strips Win11 visual styles and adds a classic 3D gradient title bar.</summary>
internal static class Win98SessionTheme
{
    private const int DwmwaWindowCornerPreference = 33;
    private const int DwmwcpDoNotRound = 1;

    private const int WM_NCLBUTTONDOWN = 0x00A1;
    private const int HTCAPTION = 0x2;

    private static readonly ConditionalWeakTable<Form, BoxedRect> SavedBounds = new();
    private static readonly ConditionalWeakTable<Form, object> InstalledChrome = new();
    private sealed record BoxedRect(Rectangle Bounds);

    public static void Apply(Form form)
    {
        form.BackColor = Color.FromArgb(192, 192, 192);
        form.Font = new Font("Tahoma", 9F);

        bool needsCustomChrome = form.FormBorderStyle != FormBorderStyle.None;
        if (needsCustomChrome && !form.IsHandleCreated)
        {
            form.FormBorderStyle = FormBorderStyle.None;
            form.Padding = new Padding(2);
        }

        form.HandleCreated += (_, _) => SetSquareCorners(form.Handle);

        ApplyClassicThemeRecursive(form);

        if (needsCustomChrome)
        {
            form.Load += (_, _) => InstallClassicWindowChrome(form);
        }
    }

    private static void ApplyClassicThemeRecursive(Control parent)
    {
        parent.ControlAdded += (_, e) =>
        {
            if (e.Control != null)
                ConfigureControl(e.Control);
        };

        foreach (Control child in parent.Controls)
        {
            ConfigureControl(child);
        }
    }

    private static void ConfigureControl(Control control)
    {
        if (control is StatusStrip status)
        {
            status.SizingGrip = false;
            status.RenderMode = ToolStripRenderMode.System;
        }
        else if (control is ToolStrip strip)
        {
            strip.RenderMode = ToolStripRenderMode.System;
        }
        else if (control is Button btn)
        {
            StyleClassicButton(btn);
        }
        else if (control is TextBoxBase or ListView or TreeView or ListBox or ComboBox)
        {
            if (control.IsHandleCreated)
                StripModernTheme(control.Handle);

            control.HandleCreated += (_, _) => StripModernTheme(control.Handle);
        }

        ApplyClassicThemeRecursive(control);
    }

    private static void StyleClassicButton(Button btn)
    {
        btn.BackColor = Color.FromArgb(192, 192, 192);
        btn.ForeColor = Color.Black;

        if (btn.Image == null && btn.ImageList == null)
        {
            // FlatStyle.System delegates drawing directly to classic Win32 GDI without VisualStyleRenderer
            btn.FlatStyle = FlatStyle.System;
            if (btn.IsHandleCreated)
                StripModernTheme(btn.Handle);
            btn.HandleCreated += (_, _) => StripModernTheme(btn.Handle);
        }
        else
        {
            // Buttons with icons use FlatStyle.Flat + custom 3D bevel so VisualStyleRenderer is bypassed
            btn.FlatStyle = FlatStyle.Flat;
            btn.FlatAppearance.BorderSize = 0;
            bool pressed = false;
            btn.MouseDown += (_, e) => { if (e.Button == MouseButtons.Left) { pressed = true; btn.Invalidate(); } };
            btn.MouseUp += (_, _) => { pressed = false; btn.Invalidate(); };
            btn.MouseLeave += (_, _) => { if (pressed) { pressed = false; btn.Invalidate(); } };
            btn.Paint += (_, e) =>
            {
                ControlPaint.DrawBorder3D(
                    e.Graphics,
                    btn.ClientRectangle,
                    pressed ? Border3DStyle.Sunken : Border3DStyle.Raised);
            };
        }
    }

    private static void InstallClassicWindowChrome(Form form)
    {
        if (InstalledChrome.TryGetValue(form, out _))
            return;
        InstalledChrome.Add(form, new object());

        if (form.FormBorderStyle != FormBorderStyle.None)
        {
            form.FormBorderStyle = FormBorderStyle.None;
            form.Padding = new Padding(2);
        }

        form.Paint += (_, e) =>
        {
            ControlPaint.DrawBorder3D(e.Graphics, form.ClientRectangle, Border3DStyle.Raised);
        };

        var titleBar = new Panel
        {
            Dock = DockStyle.Top,
            Height = 22,
            Margin = new Padding(0),
            Padding = new Padding(3, 2, 3, 2)
        };

        titleBar.Paint += (_, e) =>
        {
            if (titleBar.Width <= 0 || titleBar.Height <= 0)
                return;

            using var brush = new LinearGradientBrush(
                titleBar.ClientRectangle,
                Color.FromArgb(0, 0, 128),
                Color.FromArgb(16, 132, 208),
                LinearGradientMode.Horizontal);
            e.Graphics.FillRectangle(brush, titleBar.ClientRectangle);
        };

        Bitmap? iconBmp = null;
        try
        {
            iconBmp = form.Icon?.ToBitmap();
        }
        catch
        {
        }

        var iconBox = new PictureBox
        {
            Left = 4,
            Top = 3,
            Width = 16,
            Height = 16,
            SizeMode = PictureBoxSizeMode.StretchImage,
            BackColor = Color.Transparent,
            Image = iconBmp
        };
        titleBar.Controls.Add(iconBox);

        var titleLabel = new Label
        {
            Text = form.Text,
            Left = iconBmp != null ? 24 : 6,
            Top = 2,
            Height = 18,
            AutoSize = false,
            ForeColor = Color.White,
            BackColor = Color.Transparent,
            Font = new Font("Tahoma", 8.5F, FontStyle.Bold),
            TextAlign = ContentAlignment.MiddleLeft
        };
        titleBar.Controls.Add(titleLabel);

        form.TextChanged += (_, _) => titleLabel.Text = form.Text;

        var closeBtn = CreateCaptionButton("×");
        closeBtn.Click += (_, _) => form.Close();

        var maxBtn = CreateCaptionButton("□");
        maxBtn.Click += (_, _) => ToggleMaximize(form);

        var minBtn = CreateCaptionButton("_");
        minBtn.Click += (_, _) => form.WindowState = FormWindowState.Minimized;

        titleBar.Controls.Add(closeBtn);
        titleBar.Controls.Add(maxBtn);
        titleBar.Controls.Add(minBtn);

        void LayoutCaption()
        {
            int right = titleBar.ClientSize.Width - 3;
            closeBtn.Location = new Point(right - closeBtn.Width, 2);
            right -= closeBtn.Width + 2;

            if (form.MaximizeBox)
            {
                maxBtn.Visible = true;
                maxBtn.Location = new Point(right - maxBtn.Width, 2);
                right -= maxBtn.Width;
            }
            else
            {
                maxBtn.Visible = false;
            }

            if (form.MinimizeBox)
            {
                minBtn.Visible = true;
                minBtn.Location = new Point(right - minBtn.Width, 2);
                right -= minBtn.Width + 4;
            }
            else
            {
                minBtn.Visible = false;
            }

            titleLabel.Width = Math.Max(40, right - titleLabel.Left);
        }

        titleBar.Resize += (_, _) => LayoutCaption();
        LayoutCaption();

        void StartWindowDrag(object? sender, MouseEventArgs e)
        {
            if (e.Button != MouseButtons.Left)
                return;

            if (e.Clicks == 2 && form.MaximizeBox)
            {
                ToggleMaximize(form);
                return;
            }

            ReleaseCapture();
            SendMessage(form.Handle, WM_NCLBUTTONDOWN, new IntPtr(HTCAPTION), IntPtr.Zero);
        }

        titleBar.MouseDown += StartWindowDrag;
        titleLabel.MouseDown += StartWindowDrag;
        iconBox.MouseDown += StartWindowDrag;

        form.Controls.Add(titleBar);
        titleBar.SendToBack();
    }

    private static void ToggleMaximize(Form form)
    {
        var workArea = Screen.FromControl(form).WorkingArea;
        if (SavedBounds.TryGetValue(form, out var saved) && form.Bounds == workArea)
        {
            form.Bounds = saved.Bounds;
            SavedBounds.Remove(form);
        }
        else
        {
            SavedBounds.AddOrUpdate(form, new BoxedRect(form.Bounds));
            form.WindowState = FormWindowState.Normal;
            form.Bounds = workArea;
        }
    }

    private static Button CreateCaptionButton(string glyph)
    {
        var btn = new Button
        {
            Text = glyph,
            Width = 18,
            Height = 17,
            BackColor = Color.FromArgb(192, 192, 192),
            ForeColor = Color.Black,
            FlatStyle = FlatStyle.System,
            Font = new Font("Tahoma", 7.5F, FontStyle.Bold),
            Padding = new Padding(0),
            Margin = new Padding(0),
            TabStop = false
        };
        if (btn.IsHandleCreated)
            StripModernTheme(btn.Handle);
        btn.HandleCreated += (_, _) => StripModernTheme(btn.Handle);
        return btn;
    }

    private static void StripModernTheme(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero)
            return;

        try
        {
            SetWindowTheme(hwnd, "", "");
        }
        catch
        {
        }
    }

    private static void SetSquareCorners(IntPtr hwnd)
    {
        if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22000))
            return;

        try
        {
            int preference = DwmwcpDoNotRound;
            DwmSetWindowAttribute(hwnd, DwmwaWindowCornerPreference, ref preference, sizeof(int));
        }
        catch (DllNotFoundException)
        {
        }
        catch (EntryPointNotFoundException)
        {
        }
    }

    [DllImport("dwmapi.dll", PreserveSig = true)]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

    [DllImport("uxtheme.dll", ExactSpelling = true, CharSet = CharSet.Unicode)]
    private static extern int SetWindowTheme(IntPtr hwnd, string pszSubAppName, string pszSubIdList);

    [DllImport("user32.dll")]
    private static extern bool ReleaseCapture();

    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
}