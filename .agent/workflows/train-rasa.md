---
description: How to train the Rasa model
---

# Rasa Training Workflow

// turbo-all

1. Navigate to the project directory:
   ```
   cd d:\99T\Rasa\my-glpi-bot
   ```

2. Run the training command with 4 threads:
   ```
   rasa train --num-threads 4
   ```

3. The trained model will be saved to the `models/` directory.

4. Restart the services to use the new model:
   ```
   powershell -ExecutionPolicy Bypass -File .\start_all.ps1
   ```
