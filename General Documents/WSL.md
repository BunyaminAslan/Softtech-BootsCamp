WSL + tmux ile her agent'a ayrı panel
Ekran şöyle görünür:


┌──────────────────────┬──────────────────────┐
│ precommit-lead       │ reviewer             │
│ (lider)              │ SOLID kontrolü...    │
│                      ├──────────────────────┤
│                      │ documenter           │
│                      │ diff analizi...      │
└──────────────────────┴──────────────────────┘
Kurulum adımları:

1. Ubuntu'yu kurun (PowerShell'i yönetici olarak açın, sonra bilgisayarı yeniden başlatmanız gerekebilir):


wsl --install -d Ubuntu
İlk açılışta bir Linux kullanıcı adı ve parola belirlersiniz.

2. Ubuntu terminalinde gerekli araçları kurun:


sudo apt update && sudo apt install -y tmux git
curl -fsSL https://claude.ai/install.sh | bash   # Claude Code
Hook'larımız node kullandığı için Node.js de gerekiyor. apt'deki sürüm eski olabileceği için nvm ile kurmanızı öneririm.

3. Claude'a giriş yapın ve split pane modunu açın:


claude            # ilk açılışta giriş ister, sonra çıkın
mkdir -p ~/.claude && echo '{ "teammateMode": "tmux" }' > ~/.claude/settings.json
4. Takımı başlatın:


tmux new -s takim
cd "/mnt/c/Users/Azad_/source/repos/Softtech BootsCamp"
claude
Ardından değişikliklerimi commit öncesi kontrol et yazın. Teammate'ler açıldıkça her biri kendi panelinde belirir.

tmux kısayolları:

Kısayol	Ne yapar
Ctrl+B sonra ok tuşu	Paneller arasında geç
Ctrl+B sonra z	Seçili paneli tam ekran yap / geri al
Ctrl+B sonra d	tmux'tan ayrıl (arka planda çalışmaya devam eder)
tmux attach -t takim	Ayrıldığınız oturuma geri dön