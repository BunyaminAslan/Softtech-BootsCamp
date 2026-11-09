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


## Her bilgisayar açılışında başlatma

Bilgisayar yeniden başlayınca WSL ve tmux oturumları kapanır. Kurulumu tekrarlamaya gerek yok; sadece oturumu yeniden açmak yeterli.

### Elle başlatma (3 komut)

Windows Terminal'de sekme menüsünden (˅) **Ubuntu**'yu açın, sonra:

    cd "/mnt/c/Users/Azad_/source/repos/Softtech BootsCamp"
    tmux new -A -s precommit
    claude

`-A`: oturum varsa ona bağlanır, yoksa yenisini açar. Yani bu komut her durumda çalışır.

### Tek komutla başlatma (alias)

Bir kereliğine Ubuntu'da `~/.bashrc` dosyasına ekleyin:

    echo 'alias takim="cd \"/mnt/c/Users/Azad_/source/repos/Softtech BootsCamp\" && tmux new -A -s precommit"' >> ~/.bashrc
    source ~/.bashrc

Bundan sonra Ubuntu'yu açıp sadece `takim` yazın, ardından `claude`.

### Tek tıkla başlatma (Windows Terminal profili)

Windows Terminal → Ayarlar → **Yeni profil ekle** → Komut satırı alanına:

    wsl.exe -d Ubuntu --cd "C:\Users\Azad_\source\repos\Softtech BootsCamp" -e tmux new -A -s precommit

Profile "Precommit Takımı" gibi bir ad verin. Açınca doğrudan proje klasöründe, tmux içinde başlar; sadece `claude` yazmanız yeterli.

### Kontrol listesi

| Kontrol | Komut | Beklenen |
|---|---|---|
| Doğru Claude mu? | `which claude` | `/home/azad_/.local/bin/claude` |
| tmux içinde mi? | `echo $TMUX` | Boş olmamalı |
| Claude başlığı | — | Yol `/mnt/c/...` görünmeli, `~\source\...` değil |

> ⚠️ `claude` komutu `/mnt/c/.../npm/claude` ile ilgili hata verirse `hash -r` çalıştırın. Bu, bash'in eski Windows yolunu hafızadan silmesini sağlar.

---

Dosyanın kendisinde de düzeltilmesi gereken iki yer var:

- 3. adımdaki settings.json komutu sadece teammateMode ayarını yazıyor. Agent teams özelliğini açan CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS satırı eksik. Doğrusu:
mkdir -p ~/.claude && echo '{ "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" }, "teammateMode": "tmux" }' > ~/.claude/settings.json
- PATH adımı yok. Bu yüzden claude komutu Windows sürümünü buluyordu. 2. adımdan sonra şu satır eklenmeli:
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc && source ~/.bashrc

Oturum adı dosyada takim, bizim kullandığımız precommit. Hangisini kullanacaksan bölümdeki adı ona göre değiştirebilirsin.