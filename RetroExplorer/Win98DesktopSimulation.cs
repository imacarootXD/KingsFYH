namespace RetroExplorer;

/// <summary>A reversible desktop mockup hosted as an ordinary application window.</summary>
internal sealed class Win98DesktopSimulation : Form
{
    private readonly Label clock = new() { AutoSize = false, TextAlign = ContentAlignment.MiddleCenter, Width = 76, Dock = DockStyle.Right, BorderStyle = BorderStyle.Fixed3D };
    private readonly ContextMenuStrip startMenu = new();
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 1000 };

    public Win98DesktopSimulation()
    {
        Text = "Windows 98 Desktop Simulation";
        BackColor = Color.FromArgb(0, 128, 128);
        KeyPreview = true;
        KeyDown += (_, e) =>
        {
            if (e.KeyCode == Keys.Escape)
                Close();
        };
        var backgroundPath = FindBackground();
        if (backgroundPath != null)
        {
            try
            {
                BackgroundImage = new Bitmap(backgroundPath);
                BackgroundImageLayout = ImageLayout.Stretch;
            }
            catch (ArgumentException)
            {
            }
        }
        FormBorderStyle = FormBorderStyle.Sizable;
        StartPosition = FormStartPosition.CenterScreen;
        Width = 900; Height = 600; MinimumSize = new Size(600, 400);
        var bar = new Panel { Dock = DockStyle.Bottom, Height = 38, BackColor = Color.FromArgb(192, 192, 192), BorderStyle = BorderStyle.Fixed3D };
        var start = new Button { Text = "🪟 Start", Width = 92, Height = 28, Left = 5, Top = 4, Font = new Font("Tahoma", 9, FontStyle.Bold), FlatStyle = FlatStyle.Standard };
        start.Click += (_, _) => startMenu.Show(start, 0, -startMenu.Height);
        bar.Controls.Add(start);
        bar.Controls.Add(new Label { Text = "▥ Retro Explorer", AutoSize = false, Width = 150, Height = 27, Left = 105, Top = 4, TextAlign = ContentAlignment.MiddleLeft, BorderStyle = BorderStyle.Fixed3D, BackColor = Color.FromArgb(192, 192, 192) });
        bar.Controls.Add(clock);
        Controls.Add(bar);
        foreach (var item in new[] { "Programs", "Documents", "Settings", "Find", "Help", "Shut Down..." })
            startMenu.Items.Add(item, null, (_, _) => MessageBox.Show(this, "This desktop preview does not change Windows settings.", item));
        timer.Tick += (_, _) => clock.Text = DateTime.Now.ToString("h:mm tt");
        timer.Start();
        FormClosed += (_, _) => timer.Dispose();
        AddDesktopIcons();
    }

    private void AddDesktopIcons()
    {
        var desktopIcons = new[]
        {
            ("My Computer", "computer_explorer-0.png", 24, 24),
            ("My Documents", "directory_open_file_mydocs-0.png", 24, 112),
            ("Network Neighborhood", "entire_network_globe-0.png", 24, 200),
            ("Recycle Bin", "recycle_bin_empty_cool-0.png", 24, 288),
            ("Control Panel", "directory_control_panel-0.png", 120, 24),
            ("Briefcase", "briefcase-0.png", 120, 112),
            ("Printers", "printer-0.png", 120, 200),
            ("Internet", "homepage-0.png", 120, 288),
            ("Help", "help_book_big-0.png", 216, 24),
            ("Desktop", "desktop_w95-0.png", 216, 112),
            ("Dial-Up Networking", "directory_dial_up_networking-0.png", 216, 200),
            ("Settings", "settings_gear-0.png", 216, 288)
        };

        foreach (var (name, fileName, left, top) in desktopIcons)
        {
            var icon = LoadDesktopIcon(fileName);
            var item = new Panel
            {
                Width = 96,
                Height = 68,
                Left = left,
                Top = top,
                BackColor = Color.Transparent
            };
            var picture = new PictureBox
            {
                Width = 32,
                Height = 32,
                Left = 32,
                Top = 2,
                SizeMode = PictureBoxSizeMode.StretchImage,
                BackColor = Color.Transparent,
                Image = icon
            };
            var label = new Label
            {
                Text = name,
                Width = 96,
                Height = 30,
                Left = 0,
                Top = 34,
                TextAlign = ContentAlignment.TopCenter,
                ForeColor = Color.White,
                BackColor = Color.Transparent
            };
            item.Controls.Add(picture);
            item.Controls.Add(label);
            item.DoubleClick += (_, _) =>
            {
                if (name == "My Computer")
                    OpenMainExplorer();
                else
                    MessageBox.Show(this, name + "\n\nWindows 98 desktop icon preview", name,
                        MessageBoxButtons.OK, MessageBoxIcon.Information);
            };
            Controls.Add(item);
            item.BringToFront();
        }
    }

    private static Image? LoadDesktopIcon(string fileName)
    {
        var candidates = new[]
        {
            Path.Combine(AppContext.BaseDirectory, "assets", "Windows 98 icons", fileName),
            Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..",
                "assets", "Windows 98 icons", fileName))
        };
        var path = candidates.FirstOrDefault(File.Exists);
        if (path == null)
            return null;

        try
        {
            using var source = new Bitmap(path);
            return new Bitmap(source, new Size(32, 32));
        }
        catch (ArgumentException)
        {
            return null;
        }
    }

    private static void OpenMainExplorer()
    {
        var form = Application.OpenForms.OfType<MainForm>().FirstOrDefault();
        if (form == null)
            return;
        if (form.WindowState == FormWindowState.Minimized)
            form.WindowState = FormWindowState.Normal;
        form.BringToFront();
        form.Activate();
    }

    private static string? FindBackground()
    {
        var candidates = new[]
        {
            Path.Combine(AppContext.BaseDirectory, "assets", "win95background.jpg"),
            Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "assets", "win95background.jpg"))
        };
        return candidates.FirstOrDefault(File.Exists);
    }
}
