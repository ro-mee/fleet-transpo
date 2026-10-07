import shutil
import time
from pathlib import Path
from rembg import remove, new_session
from PIL import Image

def main():
    assets_dir = Path(__file__).resolve().parent / "assets"
    vehicles_dir = assets_dir / "vehicles"
    backup_dir = assets_dir / "vehicles_original_with_bg"

    backup_dir.mkdir(parents=True, exist_ok=True)

    print("Initializing rembg session...")
    t0 = time.time()
    session = new_session()
    print(f"Session initialized in {time.time() - t0:.2f}s")

    for i in range(1, 11):
        filename = f"V{i:02d}.png"
        file_path = vehicles_dir / filename
        backup_path = backup_dir / filename

        if not file_path.exists():
            print(f"Warning: {filename} does not exist in {vehicles_dir}, skipping.")
            continue

        # Backup original if not already backed up
        if not backup_path.exists():
            shutil.copy2(file_path, backup_path)
            print(f"Backed up original {filename} -> {backup_path.name}")

        print(f"[{i}/10] Processing {filename}...")
        t_start = time.time()

        with Image.open(backup_path) as img:
            result = remove(img, session=session)
            # Save optimized PNG
            result.save(file_path, format="PNG", optimize=True)

        elapsed = time.time() - t_start
        print(f"[{i}/10] Finished {filename} in {elapsed:.2f}s (saved to {file_path})")

    print("\nAll 10 vehicles processed successfully!")

if __name__ == "__main__":
    main()
