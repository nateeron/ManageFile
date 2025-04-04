import paramiko
import configparser

# Read the .ini file
config = configparser.ConfigParser()
config.read('commands.ini')

# Retrieve the SSH credentials and the command
hostname = config['SSH']['hostname']
username = config['SSH']['username']
password = config['SSH']['password']
service_command = config['Commands']['service_command']

# Establish SSH connection
try:
    # Initialize the SSH client
    ssh_client = paramiko.SSHClient()
    
    # Automatically add the host key if it's missing (not recommended for production)
    ssh_client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
    # Connect to the SSH server
    ssh_client.connect(hostname, username=username, password=password)
    
    # Execute the command
    stdin, stdout, stderr = ssh_client.exec_command(service_command)

    # Stream and print the output line by line
    for line in iter(stdout.readline, ""):
        print(line, end="")  # Print stdout in real-time

    # Print any error output
    for line in iter(stderr.readline, ""):
        print(line, end="")  # Print stderr in real-time

    # Close the SSH connection
    ssh_client.close()

except Exception as e:
    print(f"Error: {str(e)}")
