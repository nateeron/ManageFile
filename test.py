#!/usr/bin/env python3
"""
Test Python file for text editor functionality
"""

def hello_world():
    """Simple function to test Python syntax highlighting"""
    print("Hello, World!")
    return True

class TestClass:
    """Test class for Python syntax highlighting"""
    
    def __init__(self, name):
        self.name = name
    
    def get_name(self):
        return self.name

if __name__ == "__main__":
    # Test the functionality
    obj = TestClass("Test Object")
    hello_world()
    print(f"Object name: {obj.get_name()}") 