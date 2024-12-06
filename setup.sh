npm i
pip install -U "huggingface_hub[cli]"
huggingface-cli download sentence-transformers/all-MiniLM-L6-v2 --local-dir ./models/sentence-transformers_all-MiniLM-L6-v2 --local-dir-use-symlinks False
curl https://huggingface.co/NousResearch/Nous-Hermes-2-Mistral-7B-DPO-GGUF/resolve/main/Nous-Hermes-2-Mistral-7B-DPO.Q4_0.gguf --output "./models/Nous-Hermes-2-Mistral-7B-DPO.Q4_0.gguf"
./docker.sh

