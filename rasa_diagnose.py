
import asyncio
from rasa.core.agent import Agent
import os
import glob

async def diagnose():
    # Find latest model
    list_of_files = glob.glob('models/*.tar.gz')
    latest_model = max(list_of_files, key=os.path.getctime)
    print(f"Loading model: {latest_model}")
    
    from rasa.shared.core.trackers import UserMessage
    
    agent = Agent.load(latest_model)
    
    test_message = "Open tickets"
    metadata = {"app_id": "IT"}
    
    print(f"Testing message: '{test_message}' with metadata: {metadata}")
    
    # 1. Parse NLU
    nlu_result = await agent.parse_message(test_message)
    print(f"NLU Result: {nlu_result}")
    
    # 2. Handle Message
    user_msg = UserMessage(test_message, sender_id="test_user", metadata=metadata)
    responses = await agent.handle_message(user_msg)
    print(f"Full Responses: {responses}")

if __name__ == "__main__":
    if not os.path.exists('models') or not glob.glob('models/*.tar.gz'):
        print("No models found. Please train first.")
    else:
        asyncio.run(diagnose())
