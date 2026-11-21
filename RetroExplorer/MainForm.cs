using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

namespace RetroExplorer;

public class MainForm : Form
{
    private static readonly Color Win98Gray = Color.FromArgb(192, 192, 192);
    private static readonly Color Win98DarkGray = Color.FromArgb(128, 128, 128);
    private static readonly Color Win98Blue = Color.FromArgb(0, 0, 128);

    private readonly ImageList smallIcons = new() { ColorDepth = ColorDepth.Depth32Bit, ImageSize = new Size(16, 16) };
    private readonly ImageList largeIcons = new() { ColorDepth = ColorDepth.Depth32Bit, ImageSize = new Size(32, 32) };

    private string current;
    private readonly ListView list = new()
    {
        Dock = DockStyle.Fill,
        View = View.Details,
        FullRowSelect = true,
        MultiSelect = true
    };
    private readonly TreeView tree = new() { Dock = DockStyle.Fill };
    private readonly TextBox address = new()
    {
        BackColor = Color.White,
        BorderStyle = BorderStyle.Fixed3D
    };
    private readonly ToolStripStatusLabel info = new();
    private readonly Win98ShellManager shellManager;
    private string? clipboardPath;
    private bool cut;
    private readonly Button win98LaunchButton = new();
    private readonly Label win98Status = new();

    public MainForm(Win98ShellManager shellManager)
    {
        this.shellManager = shellManager;
        current = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        if (string.IsNullOrWhiteSpace(current))
            current = Environment.GetFolderPath(Environment.SpecialFolder.Desktop);

        Text = "Retro Explorer";
        Width = 1100;
        Height = 720;
        BackColor = Win98Gray;
        Font = new Font("Tahoma", 9, FontStyle.Regular);
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.Sizable;
        MinimumSize = new Size(760, 480);
        KeyPreview = true;
        KeyDown += (_, e) =>
        {
            if (e.KeyCode == Keys.Escape)
            {
                Close();
                e.Handled = true;
                e.SuppressKeyPress = true;
            }
        };
        InitializeIcons();
        Icon = CreateWindowIcon();
        Win98SessionTheme.Apply(this);
        FormClosed += (_, _) => shellManager.Restore();

        var menu = new MenuStrip();
        Style3DMenu(menu);
        foreach (var (name, items) in new[]
        {
            ("File", new[] { "New Folder", "New File", "Rename", "Delete", "Properties", "Exit" }),
            ("Edit", new[] { "Cut", "Copy", "Paste", "Select All" }),
            ("View", new[] { "Large Icons", "Small Icons", "List", "Details", "Refresh" }),
            ("Tools", new[] { "Search", "Windows 98 Desktop Preview", "Enable Windows 98 System Mode", "Restore Modern Windows" }),
            ("Help", new[] { "About" })
        })
        {
            var menuItem = new ToolStripMenuItem(name);
            foreach (var itemName in items)
            {
                var dropDownItem = menuItem.DropDownItems.Add(itemName, GetAssetImage(MenuIconName(itemName), 16), (_, _) => Action(itemName));
                dropDownItem.ImageScaling = ToolStripItemImageScaling.None;
            }
            menu.Items.Add(menuItem);
        }

        MainMenuStrip = menu;
        Controls.Add(menu);

        var bar = new ToolStrip();
        Style3DToolStrip(bar);
        foreach (var (text, action) in new[]
        {
            ("Back", (Action)(() => Navigate(Directory.GetParent(current)?.FullName ?? current))),
            ("Up", (Action)(() => Navigate(Directory.GetParent(current)?.FullName ?? current))),
            ("New Folder", (Action)(() => Action("New Folder"))),
            ("Search", (Action)(() => Action("Search"))),
            ("98 Taskbar Overlay", (Action)(() => ToggleWin98SystemMode())),
            ("Exit", (Action)(() => Close()))
        })
        {
            var button = bar.Items.Add(text, GetAssetImage(ToolbarIconName(text), 16), (_, _) => action());
            button.ImageScaling = ToolStripItemImageScaling.None;
        }
        Controls.Add(bar);

        var win98Launcher = new Panel
        {
            Dock = DockStyle.Top,
            Height = 42,
            BackColor = Win98Gray,
            BorderStyle = BorderStyle.Fixed3D
        };
        win98LaunchButton.Text = "  Launch Windows 98 Mode  ";
        win98LaunchButton.Width = 220;
        win98LaunchButton.Height = 30;
        win98LaunchButton.Left = 8;
        win98LaunchButton.Top = 5;
        win98LaunchButton.Font = new Font("Tahoma", 9, FontStyle.Bold);
        win98LaunchButton.Image = GetAssetImage("computer_explorer-0.png", 16);
        win98LaunchButton.ImageAlign = ContentAlignment.MiddleLeft;
        win98LaunchButton.TextAlign = ContentAlignment.MiddleRight;
        win98LaunchButton.FlatStyle = FlatStyle.Standard;
        win98LaunchButton.Click += (_, _) => ToggleWin98SystemMode();
        win98Launcher.Controls.Add(win98LaunchButton);

        win98Status.Text = "WINDOWS 98 OVERLAY: OFF";
        win98Status.AutoSize = false;
        win98Status.Width = 620;
        win98Status.Height = 26;
        win98Status.Left = 238;
        win98Status.Top = 8;
        win98Status.TextAlign = ContentAlignment.MiddleLeft;
        win98Status.ForeColor = Color.FromArgb(64, 64, 64);
        win98Launcher.Controls.Add(win98Status);
        Controls.Add(win98Launcher);

        var addressPanel = new Panel
        {
            Dock = DockStyle.Top,
            Height = 34,
            BackColor = Win98Gray,
            Padding = new Padding(4)
        };
        addressPanel.Controls.Add(new Label
        {
            Text = "Address",
            AutoSize = true,
            Location = new Point(4, 8)
        });
        address.Location = new Point(58, 4);
        address.Width = Math.Max(300, addressPanel.Width - 66);
        address.Anchor = AnchorStyles.Left | AnchorStyles.Top | AnchorStyles.Right;
        address.BackColor = Color.White;
        address.BorderStyle = BorderStyle.Fixed3D;
        addressPanel.Controls.Add(address);
        address.KeyDown += (_, e) =>
        {
            if (e.KeyCode == Keys.Enter)
            {
                Navigate(address.Text);
                e.SuppressKeyPress = true;
            }
        };
        Controls.Add(addressPanel);

        list.Columns.Add("Name", 300);
        list.Columns.Add("Type", 140);
        list.Columns.Add("Size", 100);
        list.Columns.Add("Date Modified", 180);
        list.DoubleClick += (_, _) => Open();
        list.KeyDown += KeysWork;
        list.ContextMenuStrip = CreateContextMenu();
        list.BorderStyle = BorderStyle.Fixed3D;
        list.BackColor = Color.White;
        list.ForeColor = Color.Black;
        list.HideSelection = false;
        list.SmallImageList = smallIcons;
        list.LargeImageList = largeIcons;
        tree.BorderStyle = BorderStyle.Fixed3D;
        tree.BackColor = Color.White;
        tree.ForeColor = Color.Black;
        tree.ShowLines = true;
        tree.ShowPlusMinus = true;
        tree.ShowRootLines = true;
        tree.ImageList = smallIcons;

        tree.NodeMouseDoubleClick += (_, e) =>
        {
            if (e.Node?.Tag is string path && Directory.Exists(path))
                Navigate(path);
        };

        var split = new SplitContainer
        {
            Dock = DockStyle.Fill,
            SplitterDistance = 230,
            BackColor = Win98Gray,
            BorderStyle = BorderStyle.Fixed3D
        };
        split.Panel1.Controls.Add(tree);
        split.Panel2.Controls.Add(list);
        Controls.Add(split);

        var status = new StatusStrip();
        status.BackColor = Win98Gray;
        status.SizingGrip = true;
        status.RenderMode = ToolStripRenderMode.System;
        status.Items.Add(info);
        Controls.Add(status);

        Load += (_, _) =>
        {
            var root = tree.Nodes.Add("This PC");
            root.ImageKey = "computer";
            root.SelectedImageKey = "computer";
            foreach (var drive in DriveInfo.GetDrives())
            {
                if (!drive.IsReady)
                    continue;

                var node = root.Nodes.Add(drive.Name);
                node.Tag = drive.RootDirectory.FullName;
                node.ImageKey = "drive";
                node.SelectedImageKey = "drive";
                if (HasAccessibleChildDirectories(drive.RootDirectory.FullName))
                    node.Nodes.Add("Loading...");
            }
            root.Expand();
            Navigate(current);
        };

        tree.BeforeExpand += (_, e) =>
        {
            if (e.Node == null || e.Node.Nodes.Count != 1 || e.Node.Nodes[0].Text != "Loading...")
                return;

            e.Node.Nodes.Clear();
            if (e.Node.Tag is not string path)
                return;
            PopulateTreeDirectories(e.Node, path);
        };
        tree.AfterExpand += (_, e) =>
        {
            if (e.Node?.ImageKey == "folder") e.Node.ImageKey = "folder-open";
            if (e.Node?.SelectedImageKey == "folder") e.Node.SelectedImageKey = "folder-open";
        };
        tree.AfterCollapse += (_, e) =>
        {
            if (e.Node?.ImageKey == "folder-open") e.Node.ImageKey = "folder";
            if (e.Node?.SelectedImageKey == "folder-open") e.Node.SelectedImageKey = "folder";
        };
    }

    private string AssetDirectory
    {
        get
        {
            var published = Path.Combine(AppContext.BaseDirectory, "assets", "Windows 98 icons");
            if (Directory.Exists(published))
                return published;

            var project = Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "assets", "Windows 98 icons");
            return Path.GetFullPath(project);
        }
    }

    private void InitializeIcons()
    {
        AddIcon("folder", "directory_closed_cool-0.png");
        AddIcon("folder-open", "directory_open_cool-0.png");
        AddIcon("computer", "computer_explorer-0.png");
        AddIcon("drive", "hard_disk_drive-0.png");
        AddIcon("document", "document-0.png");
        AddIcon("executable", "executable-0.png");
        AddIcon("html", "html-0.png");
        AddIcon("image", "imagpng-0.png");
        AddIcon("jpeg", "imagjpeg-0.png");
        AddIcon("search", "magnifying_glass-0.png");
        AddIcon("notepad", "notepad-0.png");
    }

    private void AddIcon(string key, string fileName)
    {
        var path = Path.Combine(AssetDirectory, fileName);
        if (!File.Exists(path))
            return;

        try
        {
            using var source = new Bitmap(path);
            using var small = new Bitmap(source, smallIcons.ImageSize);
            using var large = new Bitmap(source, largeIcons.ImageSize);
            smallIcons.Images.Add(key, new Bitmap(small));
            largeIcons.Images.Add(key, new Bitmap(large));
        }
        catch (ArgumentException)
        {
        }
    }

    private Image? GetAssetImage(string fileName, int size)
    {
        var path = Path.Combine(AssetDirectory, fileName);
        if (!File.Exists(path))
            return null;

        try
        {
            using var source = new Bitmap(path);
            return new Bitmap(source, new Size(size, size));
        }
        catch (ArgumentException)
        {
            return null;
        }
    }

    private Icon? CreateWindowIcon()
    {
        var path = Path.Combine(AssetDirectory, "computer_explorer-0.png");
        if (!File.Exists(path))
            return null;

        try
        {
            using var bitmap = new Bitmap(path);
            return Icon.FromHandle(bitmap.GetHicon());
        }
        catch (ArgumentException)
        {
            return null;
        }
    }

    private static string ToolbarIconName(string text) => text switch
    {
        "Search" => "magnifying_glass-0.png",
        "New Folder" => "directory_closed_cool-0.png",
        "Back" => "computer_explorer-0.png",
        "Up" => "directory_open_cabinet-0.png",
        "98 Taskbar Overlay" => "key_win-0.png",
        "Exit" => "erase_file-0.png",
        _ => "document-0.png"
    };

    private static string MenuIconName(string text) => text switch
    {
        "Search" => "magnifying_glass-0.png",
        "New Folder" => "directory_closed_cool-0.png",
        "New File" => "document-0.png",
        "Delete" => "erase_file-0.png",
        "Rename" => "notepad-0.png",
        "Properties" => "display_properties-0.png",
        "About" => "help_question_mark-0.png",
        "Cut" => "erase_file-0.png",
        "Copy" => "document-0.png",
        "Paste" => "notepad-0.png",
        "Refresh" => "history-0.png",
        _ => "document-0.png"
    };

    private void Style3DMenu(MenuStrip menu)
    {
        menu.BackColor = Win98Gray;
        menu.ForeColor = Color.Black;
        menu.RenderMode = ToolStripRenderMode.System;
    }

    private void Style3DToolStrip(ToolStrip strip)
    {
        strip.BackColor = Win98Gray;
        strip.GripStyle = ToolStripGripStyle.Hidden;
        strip.RenderMode = ToolStripRenderMode.System;
    }

    private void Navigate(string path)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(path) || !Directory.Exists(path))
                throw new DirectoryNotFoundException(path);

            current = Path.GetFullPath(path);
            address.Text = current;
            list.Items.Clear();

            foreach (var directory in SafeEnumerateDirectories(current))
            {
                var directoryInfo = new DirectoryInfo(directory);
                Add(directoryInfo.Name, "File folder", "", directoryInfo.LastWriteTime, "folder", directory);
            }

            foreach (var file in SafeEnumerateFiles(current))
            {
                var fileInfo = new FileInfo(file);
                Add(fileInfo.Name, fileInfo.Extension.Length > 0 ? fileInfo.Extension + " File" : "File",
                    fileInfo.Length.ToString("N0"), fileInfo.LastWriteTime, FileIconKey(fileInfo.Extension), file);
            }

            info.Text = $"{list.Items.Count} objects in {current}";
            Text = $"{current} - Retro Explorer";
            UpdateTreeSelection(current);
        }
        catch (Exception ex)
        {
            address.Text = current;
            ShowError(ex);
        }
    }

    private void UpdateTreeSelection(string path)
    {
        var full = Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        foreach (TreeNode root in tree.Nodes)
        {
            foreach (TreeNode drive in root.Nodes)
            {
                if (drive.Tag is not string drivePath || !full.StartsWith(drivePath, StringComparison.OrdinalIgnoreCase)) continue;
                drive.Expand();
                var node = drive;
                var relative = Path.GetRelativePath(drivePath, path);
                if (relative != ".") foreach (var part in relative.Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries))
                {
                    var child = node.Nodes.Cast<TreeNode>().FirstOrDefault(n => string.Equals(n.Text, part, StringComparison.OrdinalIgnoreCase));
                    if (child == null) break;
                    child.Expand(); node = child;
                }
                tree.SelectedNode = node;
                return;
            }
        }
    }

    private static IEnumerable<string> SafeEnumerateDirectories(string path)
    {
        try
        {
            return Directory.EnumerateDirectories(path).OrderBy(Path.GetFileName, StringComparer.OrdinalIgnoreCase).ToArray();
        }
        catch (UnauthorizedAccessException)
        {
            return Array.Empty<string>();
        }
        catch (IOException)
        {
            return Array.Empty<string>();
        }
    }

    private static IEnumerable<string> SafeEnumerateFiles(string path)
    {
        try
        {
            return Directory.EnumerateFiles(path).OrderBy(Path.GetFileName, StringComparer.OrdinalIgnoreCase).ToArray();
        }
        catch (UnauthorizedAccessException)
        {
            return Array.Empty<string>();
        }
        catch (IOException)
        {
            return Array.Empty<string>();
        }
    }

    private static bool HasAccessibleChildDirectories(string path)
    {
        try
        {
            return Directory.EnumerateDirectories(path).Take(1).Any();
        }
        catch
        {
            return false;
        }
    }

    private void PopulateTreeDirectories(TreeNode parent, string path)
    {
        foreach (var directory in SafeEnumerateDirectories(path))
        {
            var node = parent.Nodes.Add(Path.GetFileName(directory));
            node.Tag = directory;
            node.ImageKey = "folder";
            node.SelectedImageKey = "folder-open";
            if (HasAccessibleChildDirectories(directory))
                node.Nodes.Add("Loading...");
        }
    }

    private void Add(string name, string type, string size, DateTime date, string iconKey, string path)
    {
        var item = new ListViewItem(name) { Tag = path, ImageKey = iconKey };
        item.SubItems.Add(type);
        item.SubItems.Add(size);
        item.SubItems.Add(date.ToString());
        list.Items.Add(item);
    }

    private static string FileIconKey(string extension) => extension.ToLowerInvariant() switch
    {
        ".exe" or ".com" or ".bat" or ".cmd" => "executable",
        ".html" or ".htm" => "html",
        ".png" or ".gif" or ".bmp" or ".ico" or ".tif" or ".tiff" => "image",
        ".jpg" or ".jpeg" or ".jfif" => "jpeg",
        ".txt" or ".log" or ".ini" or ".md" or ".csv" => "notepad",
        _ => "document"
    };

    private void Action(string action)
    {
        try
        {
            var selectedPath = list.SelectedItems.Count > 0
                ? (string)list.SelectedItems[0].Tag!
                : null;

            switch (action)
            {
                case "New Folder":
                    CreateItem("New Folder", true);
                    break;
                case "New File":
                    CreateItem("New File", false);
                    break;
                case "Rename":
                    RenameSelected(selectedPath);
                    break;
                case "Delete":
                    DeleteSelected();
                    break;
                case "Copy":
                case "Cut":
                    if (selectedPath != null)
                    {
                        clipboardPath = selectedPath;
                        cut = action == "Cut";
                    }
                    break;
                case "Paste":
                    Paste();
                    break;
                case "Properties":
                    if (selectedPath != null)
                        ShowProperties(selectedPath);
                    break;
                case "Select All":
                    foreach (ListViewItem item in list.Items)
                        item.Selected = true;
                    break;
                case "Search":
                    Search();
                    break;
                case "Windows 98 Desktop Preview":
                    using (var preview = new Win98DesktopSimulation()) preview.ShowDialog(this);
                    break;
                case "Enable Windows 98 System Mode":
                case "Restore Modern Windows":
                    ToggleWin98SystemMode();
                    break;
                case "Refresh":
                    Navigate(current);
                    break;
                case "Exit":
                    Close();
                    break;
                case "About":
                    MessageBox.Show(this, "Retro Explorer\nA desktop file explorer for Windows 10 and 11.",
                        "About", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    break;
                case "Details":
                    list.View = View.Details;
                    break;
                case "List":
                    list.View = View.List;
                    break;
                case "Large Icons":
                    list.View = View.LargeIcon;
                    break;
                case "Small Icons":
                    list.View = View.SmallIcon;
                    break;
            }
        }
        catch (Exception ex)
        {
            ShowError(ex);
        }
    }

    private void CreateItem(string title, bool directory)
    {
        using var dialog = new NameDialog(title);
        if (dialog.ShowDialog(this) != DialogResult.OK)
            return;

        var destination = Path.Combine(current, dialog.Value);
        if (directory)
            Directory.CreateDirectory(destination);
        else
            File.WriteAllText(destination, "");
        Navigate(current);
    }

    private void RenameSelected(string? path)
    {
        if (path == null)
            return;

        using var dialog = new NameDialog("Rename", Path.GetFileName(path));
        if (dialog.ShowDialog(this) != DialogResult.OK)
            return;

        var destination = Path.Combine(current, dialog.Value);
        if (Directory.Exists(path))
            Directory.Move(path, destination);
        else
            File.Move(path, destination);
        Navigate(current);
    }

    private void DeleteSelected()
    {
        foreach (ListViewItem item in list.SelectedItems)
        {
            var path = (string)item.Tag!;
            var confirmed = MessageBox.Show(this,
                $"Move {Path.GetFileName(path)} to the Recycle Bin?",
                "Confirm Delete", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
            if (confirmed != DialogResult.Yes)
                continue;

            if (Directory.Exists(path))
                Microsoft.VisualBasic.FileIO.FileSystem.DeleteDirectory(
                    path,
                    Microsoft.VisualBasic.FileIO.UIOption.OnlyErrorDialogs,
                    Microsoft.VisualBasic.FileIO.RecycleOption.SendToRecycleBin);
            else
                Microsoft.VisualBasic.FileIO.FileSystem.DeleteFile(
                    path,
                    Microsoft.VisualBasic.FileIO.UIOption.OnlyErrorDialogs,
                    Microsoft.VisualBasic.FileIO.RecycleOption.SendToRecycleBin);
        }
        Navigate(current);
    }

    private void Paste()
    {
        if (clipboardPath == null)
            return;

        var destination = Path.Combine(current, Path.GetFileName(clipboardPath));
        if (!string.Equals(Path.GetFullPath(destination), Path.GetFullPath(clipboardPath),
                StringComparison.OrdinalIgnoreCase))
        {
            if (Directory.Exists(clipboardPath))
            {
                if (cut)
                    Directory.Move(clipboardPath, destination);
                else
                    CopyDirectory(clipboardPath, destination);
            }
            else
            {
                if (cut)
                    File.Move(clipboardPath, destination);
                else
                    File.Copy(clipboardPath, destination);
            }
        }

        clipboardPath = null;
        cut = false;
        Navigate(current);
    }

    private void ShowProperties(string path)
    {
        var text = Directory.Exists(path)
            ? $"Location: {path}"
            : $"Location: {path}\nSize: {new FileInfo(path).Length:N0} bytes";
        MessageBox.Show(this, text, "Properties", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    private void Search()
    {
        using var dialog = new NameDialog("Search files and folders");
        if (dialog.ShowDialog(this) != DialogResult.OK)
            return;

        list.Items.Clear();
        var matches = 0;
        SearchDirectory(current, dialog.Value, ref matches);
        info.Text = $"{matches} matches";
    }

    private void SearchDirectory(string directory, string query, ref int matches)
    {
        if (matches >= 500)
            return;

        try
        {
            foreach (var entry in Directory.EnumerateFileSystemEntries(directory))
            {
                if (matches >= 500)
                    break;

                if (Path.GetFileName(entry).Contains(query, StringComparison.OrdinalIgnoreCase))
                {
                    if (Directory.Exists(entry))
                    {
                        var directoryInfo = new DirectoryInfo(entry);
                        Add(directoryInfo.Name, "File folder", "", directoryInfo.LastWriteTime, "folder", entry);
                    }
                    else
                    {
                        var fileInfo = new FileInfo(entry);
                        Add(fileInfo.Name, fileInfo.Extension.Length > 0 ? fileInfo.Extension + " File" : "File",
                            fileInfo.Length.ToString("N0"), fileInfo.LastWriteTime, FileIconKey(fileInfo.Extension), entry);
                    }
                    matches++;
                }

                if (Directory.Exists(entry))
                    SearchDirectory(entry, query, ref matches);
            }
        }
        catch (UnauthorizedAccessException)
        {
        }
        catch (IOException)
        {
        }
    }

    private void Open()
    {
        if (list.SelectedItems.Count == 0)
            return;

        var path = (string)list.SelectedItems[0].Tag!;
        if (Directory.Exists(path))
            Navigate(path);
        else
            Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
    }

    public void ToggleWin98SystemMode()
    {
        try
        {
            if (shellManager.Active)
            {
                shellManager.Restore();
                win98Status.Text = "WINDOWS 98 OVERLAY: OFF";
                win98LaunchButton.Text = "  Launch Windows 98 Mode  ";
            }
            else
            {
                shellManager.Enable();
                win98Status.Text = shellManager.GetOverlayStatus();
                win98LaunchButton.Text = "  Close Windows 98 Overlay  ";
            }
        }
        catch (Exception ex)
        {
            ShowError(ex);
        }
    }

    public void OpenDesktopPreview()
    {
        using var preview = new Win98DesktopSimulation();
        preview.ShowDialog(this);
    }

    public void PerformMenuAction(string action)
    {
        Action(action);
    }

    private void KeysWork(object? sender, KeyEventArgs e)
    {
        if (e.KeyCode == Keys.Delete) Action("Delete");
        if (e.KeyCode == Keys.F2) Action("Rename");
        if (e.KeyCode == Keys.F5) Action("Refresh");
        if (e.Control && e.KeyCode == Keys.C) Action("Copy");
        if (e.Control && e.KeyCode == Keys.X) Action("Cut");
        if (e.Control && e.KeyCode == Keys.V) Action("Paste");
        if (e.Control && e.KeyCode == Keys.A) Action("Select All");
        if (e.Alt && e.KeyCode == Keys.Up)
            Navigate(Directory.GetParent(current)?.FullName ?? current);
    }

    private ContextMenuStrip CreateContextMenu()
    {
        var menu = new ContextMenuStrip();
        menu.BackColor = Win98Gray;
        menu.RenderMode = ToolStripRenderMode.System;
        foreach (var name in new[] { "Open", "Cut", "Copy", "Delete", "Rename", "Properties" })
        {
            var item = menu.Items.Add(name, GetAssetImage(MenuIconName(name), 16), (_, _) =>
            {
                if (name == "Open")
                    Open();
                else
                    Action(name);
            });
            item.ImageScaling = ToolStripItemImageScaling.None;
        }
        return menu;
    }

    private static void CopyDirectory(string source, string destination)
    {
        Directory.CreateDirectory(destination);
        foreach (var file in Directory.GetFiles(source))
            File.Copy(file, Path.Combine(destination, Path.GetFileName(file)));
        foreach (var directory in Directory.GetDirectories(source))
            CopyDirectory(directory, Path.Combine(destination, Path.GetFileName(directory)));
    }

    private void ShowError(Exception exception)
    {
        MessageBox.Show(this, exception.Message, "Retro Explorer",
            MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
}

public class NameDialog : Form
{
    public string Value => box.Text.Trim();
    private readonly TextBox box = new()
    {
        Dock = DockStyle.Top,
        BackColor = Color.White,
        BorderStyle = BorderStyle.Fixed3D
    };

    public NameDialog(string title, string value = "")
    {
        Text = title;
        Width = 380;
        Height = 140;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        StartPosition = FormStartPosition.CenterParent;
        MaximizeBox = false;
        MinimizeBox = false;
        BackColor = Color.FromArgb(192, 192, 192);
        Font = new Font("Tahoma", 9);
        box.Text = value;
        Controls.Add(box);

        var ok = new Button { Text = "OK", DialogResult = DialogResult.OK, Top = 45, Left = 190 };
        var cancel = new Button { Text = "Cancel", DialogResult = DialogResult.Cancel, Top = 45, Left = 275 };
        Controls.Add(ok);
        Controls.Add(cancel);
        AcceptButton = ok;
        CancelButton = cancel;
    }
}
