import os
import subprocess
import zipfile
from pathlib import Path

import pytest

from scripts.cleanup import clean, main, package, scan

# Tokens are built at runtime, so this file never matches the scan itself.
FAKE_TOKENS = {
    "anthropic": "sk-" + "ant-" + "api03-" + "A1b2C3d4" * 4,
    "github": "gh" + "p_" + "A1b2C3d4E5f6" * 3,
    "github_long": "gh" + "p_" + "A1b2C3d4E5" * 4,
    "github_oauth": "gh" + "o_" + "A1b2C3d4E5f6" * 3,
    "github_app": "gh" + "s_" + "A1b2C3d4E5f6" * 3,
    "github_pat": "github" + "_pat_" + "11ABCDEFG0" + "a1B2c3D4e5" * 4,
    "aws": "AK" + "IA" + "ABCDEFGH12345678",
    "aws_temporary": "AS" + "IA" + "ABCDEFGH12345678",
    "private_key": "-----BEGIN " + "RSA PRIVATE" + " KEY-----",
    "openssh_key": "-----BEGIN " + "OPENSSH PRIVATE" + " KEY-----",
    "pgp_key": "-----BEGIN " + "PGP PRIVATE" + " KEY BLOCK-----",
}


# The fixture must not depend on this machine's git config (a global gitignore, for one).
GIT_ENV = {
    **os.environ,
    "GIT_CONFIG_GLOBAL": os.devnull,
    "GIT_CONFIG_NOSYSTEM": "1",
    "XDG_CONFIG_HOME": os.devnull,  # git also reads $XDG_CONFIG_HOME/git/ignore by default
}


def git(root: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=root, check=True, capture_output=True, env=GIT_ENV)


def write(root: Path, rel: str, text: str = "x\n") -> Path:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    """A small checkout: tracked sources and a replay, plus untracked run data, dist and .env."""
    root = tmp_path / "repo"
    write(root, ".gitignore", ".env\nengine/data/runs/\nengine/data/scams/submitted/\ndist/\n")
    write(root, "README.md", "# Prøvetid\n")
    write(root, "engine/provetid/__init__.py")
    write(root, "engine/.env.example", "PROVETID_TRANSPORT=fake\n")
    write(root, "ui/public/replays/before.jsonl", "{}\n")
    git(root, "init", "-q")
    git(root, "add", "-A")
    write(root, ".env", "PROVETID_TRANSPORT=claude\n")
    write(root, "engine/data/runs/r1.jsonl", "{}\n")
    write(root, "engine/data/runs/r1.meta.json", "{}\n")
    write(root, "engine/data/scams/submitted/s1.json", "{}\n")
    write(root, "ui/dist/index.html", "<html></html>\n")
    return root


def test_a_clean_repo_passes(repo: Path) -> None:
    assert scan(repo) == []
    assert main([], root=repo) == 0


def test_a_planted_token_fails_and_names_the_file(
    repo: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    write(repo, "engine/notes.txt", "hei\n" + FAKE_TOKENS["anthropic"] + "\n")
    git(repo, "add", "engine/notes.txt")

    assert main([], root=repo) == 1
    assert "engine/notes.txt:2" in capsys.readouterr().out


@pytest.mark.parametrize("kind", sorted(FAKE_TOKENS))
def test_every_token_kind_is_found(repo: Path, kind: str) -> None:
    write(repo, "config.txt", f"key = {FAKE_TOKENS[kind]}\n")
    git(repo, "add", "config.txt")
    assert scan(repo) == ["config.txt:1"]


def test_prefixes_without_a_real_body_are_not_tokens(repo: Path) -> None:
    write(repo, "docs.md", "Patterns: sk-ant-, ghp_, github_pat_, AKIA and BEGIN PRIVATE KEY.\n")
    git(repo, "add", "docs.md")
    assert scan(repo) == []


def test_untracked_files_outside_dist_are_not_scanned(repo: Path) -> None:
    write(repo, "scratch.txt", FAKE_TOKENS["github"] + "\n")
    assert scan(repo) == []


def test_a_token_in_the_built_ui_is_found(repo: Path) -> None:
    write(repo, "ui/dist/assets/app.js", f'const k="{FAKE_TOKENS["anthropic"]}";\n')
    assert scan(repo) == ["ui/dist/assets/app.js:1"]


def test_clean_removes_run_data_and_keeps_the_replays(repo: Path) -> None:
    clean(repo)
    assert list((repo / "engine/data/runs").iterdir()) == []
    assert list((repo / "engine/data/scams/submitted").iterdir()) == []
    assert (repo / "ui/public/replays/before.jsonl").is_file()


def test_clean_works_when_the_folders_are_missing(tmp_path: Path) -> None:
    clean(tmp_path)


def test_the_package_holds_the_sources_dist_and_replays_and_no_env(repo: Path) -> None:
    zip_path = package(repo)

    assert zip_path == repo / "provetid-submission.zip"
    names = set(zipfile.ZipFile(zip_path).namelist())
    assert "README.md" in names
    assert "engine/provetid/__init__.py" in names
    assert "engine/.env.example" in names
    assert "ui/dist/index.html" in names
    assert "ui/public/replays/before.jsonl" in names
    assert not [n for n in names if Path(n).name == ".env"]
    assert not [n for n in names if n.startswith("engine/data/runs/")]


def test_a_tracked_env_file_is_still_left_out(repo: Path) -> None:
    write(repo, "engine/.env", "SECRET=1\n")
    git(repo, "add", "-f", "engine/.env")
    names = zipfile.ZipFile(package(repo)).namelist()
    assert "engine/.env" not in names


def test_package_mode_cleans_and_writes_the_zip(repo: Path) -> None:
    assert main(["--package"], root=repo) == 0
    assert (repo / "provetid-submission.zip").is_file()
    assert list((repo / "engine/data/runs").iterdir()) == []


def test_package_mode_refuses_to_zip_a_leaked_token(repo: Path) -> None:
    write(repo, "engine/notes.txt", FAKE_TOKENS["aws"] + "\n")
    git(repo, "add", "engine/notes.txt")
    assert main(["--package"], root=repo) == 1
    assert not (repo / "provetid-submission.zip").exists()


def test_outside_a_git_repo_nothing_is_deleted(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("GIT_CEILING_DIRECTORIES", str(tmp_path.parent))
    monkeypatch.delenv("GIT_DIR", raising=False)
    run_log = write(tmp_path, "engine/data/runs/r1.jsonl", "{}\n")
    assert main([], root=tmp_path) == 2
    assert run_log.is_file()
    assert "git" in capsys.readouterr().err


def test_a_symlink_never_brings_an_outside_file_into_the_zip(repo: Path, tmp_path: Path) -> None:
    secret = write(tmp_path, "outside/secret.txt", FAKE_TOKENS["anthropic"] + "\n")
    (repo / "ui/dist/secret.txt").symlink_to(secret)
    names = zipfile.ZipFile(package(repo)).namelist()
    assert "ui/dist/secret.txt" not in names
    assert scan(repo) == []


def test_a_symlinked_data_folder_is_not_emptied(repo: Path, tmp_path: Path) -> None:
    elsewhere = tmp_path / "elsewhere"
    keep = write(elsewhere, "important.txt")
    runs = repo / "engine/data/runs"
    for item in runs.iterdir():
        item.unlink()
    runs.rmdir()
    runs.symlink_to(elsewhere, target_is_directory=True)
    clean(repo)
    assert keep.is_file()


def test_a_token_in_a_binary_file_is_found_without_a_line(repo: Path) -> None:
    (repo / "ui/dist/font.woff2").write_bytes(b"\0\1" + FAKE_TOKENS["aws"].encode() + b"\0")
    assert scan(repo) == ["ui/dist/font.woff2:binary"]
